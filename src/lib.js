"use strict";
const path = require("path");
const ts = require("gulp-typescript");
const del = require("del");
const gulp = require("gulp");
const tslint = require("gulp-tslint");
const rename = require("gulp-rename");
const transform = require("gulp-transform");
const merge = require("merge2");

const CWD = process.cwd();

const TYPES = {
  IS_PRIMITIVE: type => "boolean|number|string|object".indexOf(type) !== -1,
  IS_IGNORED: type => "void|null|undefined|never".indexOf(type) !== -1,
  BOOLEAN: "Boolean",
  NUMBER: "Number",
  STRING: "String",
  DATE: "Date",
  OBJECT: "Object",
  ARRAY: "Array"
};

let globalTSConfig;
let projectTSConfig;

let project;

let dest;
let srcs;

exports.init = init;
function init({
  globalConfig = require(path.join(__dirname, "tsconfig.json")),
  projectConfig = require(path.join(CWD, "tsconfig.json")),
  dist = path.join(CWD, "dist"),
  src = (projectConfig.files || []).concat(projectConfig.include || []).map(src => path.join(CWD, src))
}) {
  globalTSConfig = globalConfig;
  projectTSConfig = projectConfig;
  dest = dist;
  srcs = src;

  project = ts.createProject(Object.assign({},
    globalConfig.compilerOptions,
    projectConfig.compilerOptions,
    { noEmit: false }
  ));
}

exports.clean = clean;
function clean() {
  return del([ dest ]);
}

exports.lint = lint;
function lint() {
  return new Promise((resolve, reject) => gulp
    .src(srcs)
    .pipe(tslint({ formatter: "prose" }))
    .pipe(tslint.report())
    .on("end", resolve)
    .on("error", reject));
}

function getClosestIndex(src, ptr, chars = /;|:|\(/) {
  let char;
  while ((char = src.charAt(ptr))) {
    let match = char.match(chars);
    if (!match) {
      ptr++;
      continue;
    }
    return { index: ptr, found: match[ 0 ] };
  }
}

function findClosing(src, ptr, brackets) {
  let opened = 1;
  while (opened > 0) {
    ptr++;
    switch (src.charAt(ptr)) {
      case brackets[ 0 ]:
        opened++;
        break;
      case brackets[ 1 ]:
        opened--;
        break;
    }
  }
  return ptr;
}

findClosing.OBJECT = "{}";
findClosing.ARRAY = "[]";
findClosing.GENERIC = "<>";

function regExpIndexOf(src, match, ptr) {
  let char;
  while ((char = src.charAt(ptr))) {
    if (match.test(char)) {
      return ptr;
    }
    ptr++;
  }
}

function getPropertyNoType(src, from, to) {
  let [...modifiers] = src.substr(from, to - from - 2).split(" ");
  let name = modifiers.pop();
  return { name, modifiers };
}

exports.getType = getType;
function getType(src, from = 0) {
  let start = regExpIndexOf(src, /\S/, from);
  let done = false;
  let index = start;
  let types = [];
  let type;

  while (!done) {
    switch (src.charAt(index)) {
      case ";":
        type = src.slice(start, index);
        if (type.length > 0) {
          types.push(type);
        }
        done = true;
        break;
      case "{":
        types.push(TYPES.OBJECT);
        index = findClosing(src, index, findClosing.OBJECT);
        start = ++index;
        break;
      case "[":
        types.push(TYPES.ARRAY);
        index = findClosing(src, index, findClosing.ARRAY);
        start = ++index;
        break;
      case "<":
        type = src.slice(start, index);
        if (type.length > 0) {
          types.push(type);
        }
        index = findClosing(src, index, findClosing.GENERIC);
        start = ++index;
        break;
      case "\"":
        types.push(TYPES.STRING);
        index = src.indexOf("\"", index + 1);
        start = ++index;
        break;
      case "|":
      case "&":
        type = src.slice(start, index).trim();
        start = ++index;
        if (type.length > 0) {
          types.push(type);
        }
        break;
      case "":
        return null;
      default:
        index++;
    }
  }

  type = types.reduce((type, result) => {
    if (result === TYPES.OBJECT || !type) {
      return result;
    }
    if (TYPES.IS_IGNORED(result)) {
      return type;
    }
    if (result !== type) {
      return TYPES.OBJECT
    }
    return type;
  }, null);
  if (TYPES.IS_PRIMITIVE(type)) {
    type = `${type.charAt(0).toUpperCase()}${type.substr(1)}`;
  }
  return { type, end: index };
}

function arrToObject(arr, value = true) {
  let obj = {};
  for (let i = 0, l = arr.length; i < l; i++) {
    obj[ arr[ i ] ] = value;
  }
  return obj;
}

function parseParams(src, from, to) {
  let params = src.substr(from, to - from).split(/,\s*/);
  return params.filter(param => !!param).map(param => {
    let colon = param.indexOf(":");
    if (colon === -1) {
      return { name: param };
    } else {
      let typeData = getType(`${param};`, colon + 1);
      return { name: param.substr(0, colon), type: typeData.type };
    }
  });
}

exports.parseDTS = parseDTS;
function parseDTS(dts) {
  let match = dts.match(/[\s\n]class ([\w$_]+)(?:[\s]+extends ([^{]+))?[\s]*\{/);
  if (!match) {
    return {};
  }

  const className = match[ 1 ];
  const parent = match[ 2 ];

  const properties = [];
  const methods = [];

  let start = match.index + match[ 0 ].length;

  for (
    // predefining
    let ptr = start, end = dts.length, char = dts.charAt(ptr), left = 1;
    // condition
    left > 0 && ptr < end;
    // post-actions
    char = dts.charAt(++ptr)
  ) {
    // find next non-white characters index
    let from = ptr = regExpIndexOf(dts, /\S/, ptr);

    if (dts.charAt(from) === "}") {
      break;
    }

    // TODO: decorators detection here (startsWith("@", i))

    // get modifiers and prop/method name
    let stop = getClosestIndex(dts, ptr);

    if (stop.found === ":") {
      // move pointer to first non-white char after the found index
      ptr = regExpIndexOf(dts, /\S/, stop.index + 1);
    } else if (stop.found === ";") {
      ptr = stop.index + 2;
    } else {
      ptr = stop.index;
    }

    let params;
    let done = false;
    let name;
    let modifiers;

    // check if its a method
    switch (stop.found) {
      case "(":
        ({ name, modifiers } = getPropertyNoType(dts, from, ptr + 2));
        let closing = findClosing(dts, ptr, "()");
        // TODO: parse props
        params = parseParams(dts, ptr + 1, closing);
        let typeStart = dts.indexOf(":", closing + 1) + 1;
        if (typeStart) {
          ptr = typeStart;
        } else {
          ptr = dts.indexOf(";", ptr);
          methods.push(Object.assign({}, arrToObject(modifiers), { name, params }));
          done = true;
        }
        break;
      case ";":
        ({ name, modifiers } = getPropertyNoType(dts, from, ptr));
        properties.push(Object.assign({}, arrToObject(modifiers), { name }));
        done = true;
        break;
      default:
        ({ name, modifiers } = getPropertyNoType(dts, from, ptr));
    }

    if (done) {
      continue;
    }

    let typeData;
    let type;

    typeData = getType(dts, ptr);
    type = typeData.type;
    ptr = dts.indexOf(";", typeData.end);

    if (params) {
      methods.push(Object.assign({}, arrToObject(modifiers), { name, type, params }));
    } else {
      properties.push(Object.assign({}, arrToObject(modifiers), { name, type }));
    }
  }

  return { className, parent, properties, methods };
}

exports.buildHTML = buildHTML;
function buildHTML() {
  return new Promise((resolve, reject) => {
    const stream = gulp
      .src(srcs)
      .pipe(project());

    merge([ // Merge the two output streams, so this task is finished when the IO of both operations is done.
      stream.dts
        .pipe(transform(model => {
          console.log(parseDTS(model.toString()));
        })),

      stream.js
        .pipe(transform(content => {
          let links = [];
          let scripts = [];
          content = content
            .toString()
            .replace(/require\(['"](link|script)!(.*?)['"]\);\n?/g, (m, type, module) => {
              switch (type) {
                case "link":
                  links.push(module);
                  break;
                case "script":
                  scripts.push(module);
                  break;
              }
              return "";
            });
          return Buffer.from(
            links.map(module => `<link rel="import" href="${module}">\n`).join("") +
            scripts.map(module => `<script src="${module}"></script>\n`).join("") +
            `<script>\n${content}\n</script>`
          );
        }))
        .pipe(rename({ extname: ".html" }))
        .pipe(gulp.dest(dest))
    ])
      .on("end", resolve)
      .on("error", reject);
  });
}

exports.build = build;
function build() {
  clean()
    .then(lint)
    .then(buildHTML);
}
