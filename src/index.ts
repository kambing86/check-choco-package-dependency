import axios from "axios";
import chalk from "chalk";
import cheerio from "cheerio";
import { exec } from "child_process";
import { from, of } from "rxjs";
import { distinct, filter, flatMap } from "rxjs/operators";
import treeify from "treeify";
import { promisify } from "util";
import { distinctExpand } from "./distinctExpand";

const execAsync = promisify(exec);
let startHeaderIndex = Number.MAX_SAFE_INTEGER;

const validPackage = (totalLine: number) => (
  packageString: string,
  index: number,
) => {
  if (packageString.startsWith("Chocolatey v")) {
    startHeaderIndex = index;
    return false;
  }
  if (packageString === "") {
    return false;
  }
  if (packageString.includes("packages installed.")) {
    return false;
  }
  if (index >= totalLine - 2) {
    return false;
  }
  if (index < startHeaderIndex) {
    return false;
  }
  if (packageString.split(" ").length !== 2) {
    return false;
  }
  return true;
};

const packageTree = {};
// const packageTree = {
//   "7zip": ["7zip.install"],
//   "7zip.install": ["chocolatey-core.extension"],
//   "authy-desktop": [],
//   chocolatey: [],
//   "chocolatey-dotnetfx.extension": [],
//   "chocolatey-core.extension": [],
//   "chocolatey-windowsupdate.extension": [],
//   "chocolatey-visualstudio.extension": [],
//   chocolateygui: ["Chocolatey"],
//   "dbforge-mysql-studio-exp": ["dotnet4.5.2"],
//   dotnetfx: ["chocolatey-dotnetfx.extension", "KB2919355"],
//   git: ["git.install"],
//   "git-lfs.install": ["git"],
//   "git-lfs": ["git-lfs.install"],
//   "git.install": ["chocolatey-core.extension", "chocolatey"],
//   hashtab: [],
//   javaruntime: ["jre8"],
//   jdk8: [],
//   jre8: [],
//   keeweb: [],
//   "kubernetes-cli": [],
//   "kubernetes-kompose": [],
//   minikube: ["kubernetes-cli"],
//   meld: [],
//   minishift: [],
//   nodejs: ["nodejs.install"],
//   "notepadplusplus.install": ["chocolatey-core.extension"],
//   "nodejs.install": [],
//   "obs-studio": ["obs-studio.install"],
//   "obs-studio.install": ["vcredist2017"],
//   postman: [],
//   "redis-desktop-manager": [],
//   robo3t: ["robo3t.install"],
//   "robo3t.install": [],
//   sharex: ["dotnet4.6.2"],
//   slack: [],
//   spotify: ["chocolatey-core.extension"],
//   teamviewer: [],
//   telegram: ["telegram.install"],
//   "telegram.install": ["chocolatey-core.extension"],
//   WhatsApp: [],
//   vlc: ["chocolatey-core.extension"],
//   "dotnet4.5.2": [],
//   Chocolatey: [],
//   vcredist2017: ["vcredist140"],
//   KB2919355: ["KB2919442"],
//   "dotnet4.6.2": ["netfx-4.6.2"],
//   vcredist140: [
//     "chocolatey-core.extension",
//     "KB3033929",
//     "KB2919355",
//     "kb2999226",
//   ],
//   KB2919442: [],
//   "netfx-4.6.2": ["chocolatey-dotnetfx.extension", "KB2919355"],
//   KB3033929: ["chocolatey-windowsupdate.extension", "KB3035131"],
//   kb2999226: ["kb2919355", "chocolatey-windowsupdate.extension"],
//   KB3035131: ["chocolatey-windowsupdate.extension"],
//   kb2919355: ["KB2919442"],
// };

async function getDependencies(packageName: string) {
  console.log("get", `https://chocolatey.org/packages/${packageName}`);
  const response = await axios.get(
    `https://chocolatey.org/packages/${packageName}`,
  );
  const $ = cheerio.load(response.data);
  const dependencies = $("#dependencies a");
  const returnArray: string[] = [];
  for (let i = 0; i < dependencies.length; i++) {
    const parent = $(dependencies[i].parent);
    const value = parent
      .children("a")
      .text()
      .trim();
    if (value !== "") {
      returnArray.push(parent.children("a").text());
    }
  }
  packageTree[packageName] = returnArray;
  return returnArray;
}

// async function getDataTree(packageName: string) {
//   console.log("get", `https://chocolatey.org/packages/${packageName}`);
//   const response = await axios.get(
//     `https://chocolatey.org/packages/${packageName}`,
//   );
//   const $ = cheerio.load(response.data);
//   const dependencies = $("#dependencies a");
//   const returnArray: string[] = [];
//   for (let i = 0; i < dependencies.length; i++) {
//     const parent = $(dependencies[i].parent);
//     returnArray.push(parent.children("a").text());
//   }
//   return { [packageName]: returnArray };
// }
// const original = {
//   a: ["b", "c"],
//   b: ["d", "e"],
//   c: ["1", "2"],
//   d: ["3", "4"],
// };

// const output = {
//   a: {
//     b: {
//       d: {
//         "3": null,
//         "4": null,
//       },
//       e: null,
//     },
//     c: {
//       "1": null,
//       "2": null,
//     },
//   },
// };
interface Dictionary<T> {
  [key: string]: T;
}

function generateLeaf(
  existingPackages: string[],
  tree: Dictionary<string[]>,
  value?: string[],
) {
  return value?.reduce(
    (acc, key) => ({
      ...acc,
      [`${
        existingPackages.includes(key) ? key : chalk.red(key)
      }`]: generateLeaf(existingPackages, tree, tree[key]),
    }),
    {},
  );
}

function generateTree(tree: Dictionary<string[]>, existingPackages: string[]) {
  const dependencies = Object.values(tree).flat();
  const firstLevel = Object.keys(tree).filter(v => !dependencies.includes(v));
  return generateLeaf(existingPackages, tree, firstLevel);
}

(async () => {
  const result = await execAsync("choco.exe list -l");
  const resultLines: string[] = result.stdout.split("\r\n");
  const packages = resultLines
    .filter(validPackage(resultLines.length))
    .map(packageString => packageString.split(" ")[0]);
  console.log({ packages });
  const getAll = from(packages).pipe(
    distinctExpand(
      packageName =>
        of(packageName).pipe(
          flatMap(p => getDependencies(p)),
          flatMap(v => v),
        ),
      6,
    ),
    filter(packageName => packages.includes(packageName)),
    distinct(),
  );
  getAll.subscribe(
    p => console.log(`checked: ${p}`),
    err => console.error(err),
    () => console.log(treeify.asTree(generateTree(packageTree, packages))),
  );
  // console.log(treeify.asTree(generateTree(packageTree)));
})();

/*
├─ 7zip
│  └─ 7zip.install
│     └─ chocolatey-core.extension
├─ authy-desktop
├─ chocolatey-visualstudio.extension
├─ dbforge-mysql-studio-exp
│  └─ dotnet4.5.2
├─ chocolateygui
│  └─ Chocolatey
├─ dotnetfx
│  ├─ chocolatey-dotnetfx.extension
│  └─ KB2919355
│     └─ KB2919442
├─ git-lfs
│  └─ git-lfs.install
│     └─ git
│        └─ git.install
│           ├─ chocolatey-core.extension
│           └─ chocolatey
├─ hashtab
├─ javaruntime
│  └─ jre8
├─ jdk8
├─ keeweb
├─ kubernetes-kompose
├─ meld
├─ minikube
│  └─ kubernetes-cli
├─ nodejs
│  └─ nodejs.install
├─ minishift
├─ notepadplusplus.install
│  └─ chocolatey-core.extension
├─ obs-studio
│  └─ obs-studio.install
│     └─ vcredist2017
│        └─ vcredist140
│           ├─ chocolatey-core.extension
│           ├─ KB3033929
│           │  ├─ chocolatey-windowsupdate.extension
│           │  └─ KB3035131
│           │     └─ chocolatey-windowsupdate.extension
│           ├─ KB2919355
│           │  └─ KB2919442
│           └─ kb2999226
│              ├─ kb2919355
│              │  └─ KB2919442
│              └─ chocolatey-windowsupdate.extension
├─ postman
├─ redis-desktop-manager
├─ robo3t
│  └─ robo3t.install
├─ slack
├─ sharex
│  └─ dotnet4.6.2
│     └─ netfx-4.6.2
│        ├─ chocolatey-dotnetfx.extension
│        └─ KB2919355
│           └─ KB2919442
├─ spotify
│  └─ chocolatey-core.extension
├─ teamviewer
├─ telegram
│  └─ telegram.install
│     └─ chocolatey-core.extension
├─ vlc
│  └─ chocolatey-core.extension
└─ WhatsApp
*/
