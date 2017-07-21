var Attr = require("../util").FileAttr,
  AdmZip = require("../adm-zip"),
  fs = require("fs");

zip = new AdmZip(
  "https://agroprofiles.blob.core.windows.net/files/P21-001-20170707-RGB-UNIFORMITY.zip",
  {type: "azure-blob"},
);
//zip.extractEntryTo("P21-001-20170707-RGB-UNIFORMITY/19/193040/238837.png", "./test/", false, true);
//zip.extractEntryTo("P21-001-20170707-RGB-UNIFORMITY/19/193038/238834.png", "./test/", false, true);
zip.extractEntryTo("P21-001-20170707-RGB-UNIFORMITY/16/24129/29853.png", "./test/", false, true);
/*
zip.getEntries().then(entries => {}).catch(err => {
  console.log(err);
});
*/

//zip.addLocalFile("./test/readonly.txt");
