var ZipEntry = require("./zipEntry"),
  Headers = require("./headers"),
  Utils = require("./util"),
  request = require("request");

class AzureBlobBuffer {
  constructor(url) {
    this.url = url;
  }

  getLength() {
    var self = this;
    return new Promise((resolve, reject) => {
      request(
        {
          method: "HEAD",
          url: self.url,
        },
        function(error, response, body) {
          if (error) {
            return reject(error);
          }
          resolve(parseInt(response.headers["content-length"]));
        },
      );
    });
  }

  slice(start, end) {
    var self = this;
    return new Promise((resolve, reject) => {
      request(
        {
          method: "GET",
          url: self.url,
          headers: {
            Range: `bytes=${start}-${end - 1}`,
          },
          encoding: null,
        },
        function(error, response, body) {
          if (error) {
            return reject(error);
          }
          resolve(body);
        },
      );
    });
  }

  getByte(start) {
    var self = this;
    return new Promise(async (resolve, reject) => {
      try {
        var bytes = await self.slice(start, start + 1);
        resolve(bytes[0]);
      } catch (ex) {
        reject(ex);
      }
    });
  }

  readUInt32LE(start) {
    var self = this;
    return new Promise(async (resolve, reject) => {
      try {
        var bytes = await self.slice(start, start + 4);
        resolve(bytes.readUInt32LE(0));
      } catch (ex) {
        reject(ex);
      }
    });
  }

  get length() {
    return this.getLength();
  }
}

module.exports = function(/*String|Buffer*/ input, /*Number*/ inputType) {
  var entryList = [],
    entryTable = {},
    _comment = new Buffer(0),
    filename = "",
    fs = require("fs"),
    inBuffer = null;

  if (inputType == Utils.Constants.AZURE_BLOB) {
    filename = input;
    inBuffer = new AzureBlobBuffer(filename);
    //readMainHeader();
  } else if (inputType == Utils.Constants.FILE) {
    // is a filename
    filename = input;
    inBuffer = fs.readFileSync(filename);
    readMainHeader();
  } else if (inputType == Utils.Constants.BUFFER) {
    // is a memory buffer
    inBuffer = input;
    readMainHeader();
  } else {
    // none. is a new file
  }

  function readEntries() {
    return new Promise((resolve, reject) => {
      readMainHeader()
        .then(async mainHeader => {
          debugger;
          entryTable = {};
          entryList = new Array(mainHeader.diskEntries); // total number of entries
          var index = mainHeader.offset; // offset of first CEN header
          for (var i = 0; i < entryList.length; i++) {
            var tmp = index,
              entry = new ZipEntry(inBuffer);
            entry.header = await inBuffer.slice(
              tmp,
              (tmp += Utils.Constants.CENHDR),
            );

            entry.entryName = await inBuffer.slice(
              tmp,
              (tmp += entry.header.fileNameLength),
            );

            if (entry.header.extraLength) {
              entry.extra = await inBuffer.lice(
                tmp,
                (tmp += entry.header.extraLength),
              );
            }

            if (entry.header.commentLength)
              entry.comment = await inBuffer.slice(
                tmp,
                tmp + entry.header.commentLength,
              );

            index += entry.header.entryHeaderSize;

            console.log(entry.entryName);

            entryList[i] = entry;
            entryTable[entry.entryName] = entry;
          }
        })
        .catch(reject);
    });
  }

  function readMainHeader() {
    return new Promise((resolve, reject) => {
      (async () => {
        try {
          var mainHeader = new Headers.MainHeader();
          var i = (await inBuffer.length) - Utils.Constants.ENDHDR; // END header size
          var n = Math.max(0, i - 0xffff), // 0xFFFF is the max zip file comment length
            endOffset = -1; // Start offset of the END header

          for (i; i >= n; i--) {
            if ((await inBuffer.getByte(i)) != 0x50) continue; // quick check that the byte is 'P'
            if ((await inBuffer.readUInt32LE(i)) == Utils.Constants.ENDSIG) {
              // "PK\005\006"
              endOffset = i;
              break;
            }
          }
          if (!~endOffset) throw Utils.Errors.INVALID_FORMAT;

          var data;
          if (inputType == Utils.Constants.AZURE_BLOB) {
            try {
              data = await inBuffer.slice(
                endOffset,
                endOffset + Utils.Constants.ENDHDR,
              );
            } catch (ex) {
              console.log(ex);
            }
          } else {
            data = inBuffer.slice(
              endOffset,
              endOffset + Utils.Constants.ENDHDR,
            );
          }

          mainHeader.loadFromBinary(data);
          if (mainHeader.commentLength) {
            _comment = await inBuffer.slice(endOffset + Utils.Constants.ENDHDR);
          }
          //readEntries();
          resolve(mainHeader);
        } catch (ex) {
          console.log(ex);
          reject(ex);
        }
      })();
    });
  }

  return {
    getEntries: function() {
      return new Promise((resolve, reject) => {
        readEntries().then(resolve).catch(reject);
      });
    },
    /**
         * Returns an array of ZipEntry objects existent in the current opened archive
         * @return Array
         */
    get entries() {
      return entryList;
    },

    /**
         * Archive comment
         * @return {String}
         */
    get comment() {
      return _comment.toString();
    },
    set comment(val) {
      mainHeader.commentLength = val.length;
      _comment = val;
    },

    /**
         * Returns a reference to the entry with the given name or null if entry is inexistent
         *
         * @param entryName
         * @return ZipEntry
         */
    getEntry: function(/*String*/ entryName) {
      return new Promise(async (resolve, reject) => {
        try {
          debugger;
          await readEntries();
          resolve(entryTable[entryName] || null);
        } catch (ex) {
          reject(ex);
        }
      });
      //return entryTable[entryName] || null;
    },

    /**
         * Adds the given entry to the entry list
         *
         * @param entry
         */
    setEntry: function(/*ZipEntry*/ entry) {
      entryList.push(entry);
      entryTable[entry.entryName] = entry;
      mainHeader.totalEntries = entryList.length;
    },

    /**
         * Removes the entry with the given name from the entry list.
         *
         * If the entry is a directory, then all nested files and directories will be removed
         * @param entryName
         */
    deleteEntry: function(/*String*/ entryName) {
      var entry = entryTable[entryName];
      if (entry && entry.isDirectory) {
        var _self = this;
        this.getEntryChildren(entry).forEach(function(child) {
          if (child.entryName != entryName) {
            _self.deleteEntry(child.entryName);
          }
        });
      }
      entryList.splice(entryList.indexOf(entry), 1);
      delete entryTable[entryName];
      mainHeader.totalEntries = entryList.length;
    },

    /**
         *  Iterates and returns all nested files and directories of the given entry
         *
         * @param entry
         * @return Array
         */
    getEntryChildren: function(/*ZipEntry*/ entry) {
      if (entry.isDirectory) {
        var list = [],
          name = entry.entryName,
          len = name.length;

        entryList.forEach(function(zipEntry) {
          if (zipEntry.entryName.substr(0, len) == name) {
            list.push(zipEntry);
          }
        });
        return list;
      }
      return [];
    },

    /**
         * Returns the zip file
         *
         * @return Buffer
         */
    compressToBuffer: function() {
      if (entryList.length > 1) {
        entryList.sort(function(a, b) {
          var nameA = a.entryName.toLowerCase();
          var nameB = b.entryName.toLowerCase();
          if (nameA < nameB) {
            return -1;
          }
          if (nameA > nameB) {
            return 1;
          }
          return 0;
        });
      }

      var totalSize = 0,
        dataBlock = [],
        entryHeaders = [],
        dindex = 0;

      mainHeader.size = 0;
      mainHeader.offset = 0;

      entryList.forEach(function(entry) {
        entry.header.offset = dindex;

        // compress data and set local and entry header accordingly. Reason why is called first
        var compressedData = entry.getCompressedData();
        // data header
        var dataHeader = entry.header.dataHeaderToBinary();
        var postHeader = new Buffer(entry.entryName + entry.extra.toString());
        var dataLength =
          dataHeader.length + postHeader.length + compressedData.length;

        dindex += dataLength;

        dataBlock.push(dataHeader);
        dataBlock.push(postHeader);
        dataBlock.push(compressedData);

        var entryHeader = entry.packHeader();
        entryHeaders.push(entryHeader);
        mainHeader.size += entryHeader.length;
        totalSize += dataLength + entryHeader.length;
      });

      totalSize += mainHeader.mainHeaderSize; // also includes zip file comment length
      // point to end of data and begining of central directory first record
      mainHeader.offset = dindex;

      dindex = 0;
      var outBuffer = new Buffer(totalSize);
      dataBlock.forEach(function(content) {
        content.copy(outBuffer, dindex); // write data blocks
        dindex += content.length;
      });
      entryHeaders.forEach(function(content) {
        content.copy(outBuffer, dindex); // write central directory entries
        dindex += content.length;
      });

      var mh = mainHeader.toBinary();
      if (_comment) {
        _comment.copy(mh, Utils.Constants.ENDHDR); // add zip file comment
      }

      mh.copy(outBuffer, dindex); // write main header

      return outBuffer;
    },

    toAsyncBuffer: function(
      /*Function*/ onSuccess,
      /*Function*/ onFail,
      /*Function*/ onItemStart,
      /*Function*/ onItemEnd,
    ) {
      if (entryList.length > 1) {
        entryList.sort(function(a, b) {
          var nameA = a.entryName.toLowerCase();
          var nameB = b.entryName.toLowerCase();
          if (nameA > nameB) {
            return -1;
          }
          if (nameA < nameB) {
            return 1;
          }
          return 0;
        });
      }

      var totalSize = 0,
        dataBlock = [],
        entryHeaders = [],
        dindex = 0;

      mainHeader.size = 0;
      mainHeader.offset = 0;

      var compress = function(entryList) {
        var self = arguments.callee;
        var entry;
        if (entryList.length) {
          var entry = entryList.pop();
          var name = entry.entryName + entry.extra.toString();
          if (onItemStart) onItemStart(name);
          entry.getCompressedDataAsync(function(compressedData) {
            if (onItemEnd) onItemEnd(name);

            entry.header.offset = dindex;
            // data header
            var dataHeader = entry.header.dataHeaderToBinary();
            var postHeader = new Buffer(name);
            var dataLength =
              dataHeader.length + postHeader.length + compressedData.length;

            dindex += dataLength;

            dataBlock.push(dataHeader);
            dataBlock.push(postHeader);
            dataBlock.push(compressedData);

            var entryHeader = entry.packHeader();
            entryHeaders.push(entryHeader);
            mainHeader.size += entryHeader.length;
            totalSize += dataLength + entryHeader.length;

            if (entryList.length) {
              self(entryList);
            } else {
              totalSize += mainHeader.mainHeaderSize; // also includes zip file comment length
              // point to end of data and begining of central directory first record
              mainHeader.offset = dindex;

              dindex = 0;
              var outBuffer = new Buffer(totalSize);
              dataBlock.forEach(function(content) {
                content.copy(outBuffer, dindex); // write data blocks
                dindex += content.length;
              });
              entryHeaders.forEach(function(content) {
                content.copy(outBuffer, dindex); // write central directory entries
                dindex += content.length;
              });

              var mh = mainHeader.toBinary();
              if (_comment) {
                _comment.copy(mh, Utils.Constants.ENDHDR); // add zip file comment
              }

              mh.copy(outBuffer, dindex); // write main header

              onSuccess(outBuffer);
            }
          });
        }
      };

      compress(entryList);
    },
  };
};
