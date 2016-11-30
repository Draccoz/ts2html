export type Replacer = [RegExp, string | ((...args: Array<string>) => string)];

export interface Decorator {
  src: string;
  name: string;
  params: string;
  descriptor?: string;
}
export interface FoundMatch {
  index: number;
  found: any;
}
export interface FoundType {
  end: number;
  type: string;
}
export interface ParamConfig {
  name: string;
  type?: string
}
export interface PropertyConfig {
  name: string;
  modifiers: Array<string>;
}
export interface FieldConfig {
  name: string;
  type: string;
  defaultValue?: string;
  //noinspection ReservedWordAsName
  static?: boolean;
  //noinspection ReservedWordAsName
  private?: boolean;
  //noinspection ReservedWordAsName
  protected?: boolean;
  //noinspection ReservedWordAsName
  public?: boolean;
  readonly?: boolean;
}
export interface DTSParsedData {
  className: string;
  parent: string;
  properties: Array<FieldConfig>;
  methods: Array<FieldConfig>;
}
export interface JSParsedData {
  generatedName: string;
  values: {[fieldName: string]: string;};
  methodBodies: {[fieldName: string]: string;};
  decorators: {[fieldName: string]: Array<Decorator>};
  annotations: {[fieldName: string]: Array<Decorator>};
  src: string;
}
export interface JSParserOptions {
  definedAnnotations: Array<string>;
}

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

const OBJECT_BRACKETS = "{}";
const ARRAY_BRACKETS = "[]";
const GENERIC_BRACKETS = "<>";
const ROUND_BRACKETS = "()";

/**
 * Works just like indexOf, but skips all kinds of brackets and strings
 *
 * @param src String to search
 * @param term Search term
 * @param offset (Optional) Search offset
 *
 * @returns Index of found character or -1 if not found
 */
export function goTo(src: string, term: string|RegExp, offset: number = 0): number {
  let char;
  let prevChar = null;
  let checkRegExp = typeof term !== "string";
  let stringOpen = false;

  function openString(char, prevChar) {
    if (prevChar === "\\") {
      return;
    }
    if (stringOpen === char) {
      stringOpen = false;
    }
    else if (stringOpen === false) {
      stringOpen = char;
    }
  }

  while ((char = src.charAt(offset))) {
    if (!stringOpen && (checkRegExp && (<RegExp>term).test(char) || char === term)) {
      return offset;
    }
    switch (char) {
      case "{":
        offset = findClosing(src, offset, OBJECT_BRACKETS);
        break;
      case "[":
        offset = findClosing(src, offset, ARRAY_BRACKETS);
        break;
      case "<":
        offset = findClosing(src, offset, GENERIC_BRACKETS);
        break;
      case "(":
        offset = findClosing(src, offset, ROUND_BRACKETS);
        break;
      case "'":
        openString(char, prevChar);
        break;
      case "`":
        openString(char, prevChar);
        break;
      case `"`:
        openString(char, prevChar);
        break;
    }
    prevChar = char;
    offset++;
  }
  return -1;
}

/**
 * Splits the string by given term, skips all kinds of brackets and strings
 *
 * @param src String to split
 * @param term Search term (split by this)
 * @param trim (Optional) Should chunks be trimmed
 *
 * @returns List of strings split by searched term
 */
export function split(src: string, term: string|RegExp, trim: boolean = false): string[] {
  let start = 0;
  let chunks = [];
  do {
    let comma = goTo(src, term, start);
    let chunk = comma === -1 ? src.substr(start) : src.slice(start, comma);
    chunks.push(trim ? chunk.trim() : chunk);
    start = comma + 1;
  }
  while (start > 0);
  return chunks;
}

/**
 * Find index of matching closing bracket
 *
 * @param src String to search
 * @param offset Search offset
 * @param brackets Brackets pair to match (i.e. {}, [], (), <>)
 *
 * @throws SyntaxError - Bracket has no closing
 *
 * @returns Index of found bracket
 */
export function findClosing(src: string, offset: number, brackets: string): number {
  let start = offset;
  let opened = 1;
  let char;
  while ((char = src.charAt(++offset))) {
    switch (char) {
      case brackets[ 0 ]:
        opened++;
        break;
      case brackets[ 1 ]:
        opened--;
        if (opened <= 0) {
          return offset;
        }
        break;
    }
  }
  let line = 1;
  for (let i = 0, l = start; i < l; i++) {
    if (/\n/.test(src.charAt(i))) {
      line++;
    }
  }
  throw new SyntaxError(`Parenthesis has no closing at line ${line}.`);
}

/**
 * Finds first character that matches the search criteria and returns the found character and index
 *
 * @param src String to search
 * @param term Search term
 * @param offset (Optional) Search offset
 *
 * @returns Found character and index or -1 and null, if nothing was found
 */
export function regExpClosestIndexOf(src: string, term: RegExp, offset: number = 0): FoundMatch {
  let char;
  while ((char = src.charAt(offset))) {
    let match = char.match(term);
    if (!match) {
      offset++;
      continue;
    }
    return { index: offset, found: match[ 0 ] };
  }
  return { index: -1, found: null };
}

/**
 * Get modifiers and name of a property or method (does not get types)
 *
 * @param src String to search
 * @param from (Optional) Search from this index
 * @param to (Optional) Search up to this index
 *
 * @returns name and array of property/method modifiers
 */
export function getPropertyNoType(src: string, from: number = 0, to: number = src.indexOf(";")): PropertyConfig {
  let [...modifiers] = src.slice(from, to).split(" ");
  let name = modifiers.pop();
  return { name, modifiers };
}

/**
 * Get type of property, method or param. Inline structures are casted to Object or Array.
 * Combined types are casted to Object. Generic types are stripped.
 *
 * @fixme function interface type ( () => void; )
 *
 * @param src String to search
 * @param offset (Optional) Search offset
 *
 * @returns Found type and index of the END of type declaration or null and -1 if not found
 */
export function getType(src: string, offset: number = 0): FoundType {
  let start = goTo(src, /\S/, offset);
  let done = false;
  let index = start;
  let types = [];
  let char;
  let type;

  while (!done && (char = src.charAt(index))) {
    switch (char) {
      case ")":
      case ",":
      case ";":
        type = src.slice(start, index).trim();
        if (type.length > 0) {
          types.push(type);
        }
        done = true;
        break;
      case "{":
        types.push(TYPES.OBJECT);
        index = findClosing(src, index, OBJECT_BRACKETS);
        start = ++index;
        break;
      case "[":
        types.push(TYPES.ARRAY);
        index = findClosing(src, index, ARRAY_BRACKETS);
        start = ++index;
        break;
      case "<":
        type = src.slice(start, index).trim();
        if (type.length > 0) {
          types.push(type);
        }
        index = findClosing(src, index, GENERIC_BRACKETS);
        if (index === -1) {
          return { type: null, end: -1 };
        }
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
        return { type: null, end: -1 };
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
      return TYPES.OBJECT;
    }
    return type;
  }, null);
  if (TYPES.IS_PRIMITIVE(type)) {
    type = `${type.charAt(0).toUpperCase()}${type.substr(1)}`;
  }
  return { type, end: index };
}

/**
 * Convert array to object, using given value (default `true`) as value
 *
 * @param arr Array of strings to convert
 * @param value Value to assign to keys
 *
 * @returns An object with array values as keys and given value as object values
 */
export function arrToObject(arr: Array<string>, value: any = true): any {
  let obj = {};
  for (let i = 0, l = arr.length; i < l; i++) {
    obj[ arr[ i ] ] = value;
  }
  return obj;
}

/**
 * Get list of params with their types
 *
 * @param src String to search
 * @param from (Optional) Search from this index
 * @param to (Optional) Search up to this index
 *
 * @returns List of parameter names and types
 */
export function parseParams(src: string, from: number = 0, to: number = src.length): Array<ParamConfig> {
  let params = [];
  while (from < to) {
    let firstStop = regExpClosestIndexOf(src, /,|:/, from);
    if (firstStop.index === -1) {
      params.push({ name: src.slice(from, to).trim() });
      break;
    }
    let param: ParamConfig = { name: src.slice(from, firstStop.index).trim() };

    if (firstStop.found === ":") {
      let { type, end } = getType(src, firstStop.index + 1);
      if (type) {
        param.type = type;
      }
      from = end + 1;
    }
    else {
      from = firstStop.index + 1;
    }

    params.push(param);
  }

  return params;
}

/**
 * Build a full property config
 *
 * @param mods List of field modifiers
 * @param name Property/method name
 * @param params List of parameters (names and types)
 * @param type Type of field
 *
 * @returns Field configuration object
 */
export function buildField(mods: Array<string>, name: string, params?: Array<ParamConfig>, type?: string): FieldConfig {
  let config: {name: string, params?: Array<ParamConfig>, type?: string} = { name };
  if (params) {
    config.params = params;
  }
  if (type) {
    config.type = type;
  }
  return Object.assign({}, arrToObject(mods), config);
}

/**
 * Parse TypeScript declaration to fetch class name, super class, properties and methods names, types and modifiers
 *
 * @param src String to parse
 *
 * @throws Error if no class was found
 *
 * @returns Class name, super class, properties and methods names, types and modifiers
 */
export function parseDTS(src: string): DTSParsedData {
  let match = src.match(/[\s\n]class ([\w$_]+)(?:[\s]+extends ([^{]+))?[\s]*\{/);
  if (!match) {
    throw new Error("no class found");
  }

  const className = match[ 1 ];
  const parent = match[ 2 ];

  const properties = [];
  const methods = [];

  let start = match.index + match[ 0 ].length;

  for (
    // predefining
    let ptr = start, end = src.length, char = src.charAt(ptr);
    // condition
    ptr < end;
    // post-actions
    char = src.charAt(++ptr)
  ) {
    let params, match;
    // skip whitespace
    let from = ptr = goTo(src, /\S/, ptr);

    // is it the end of class?
    if (src.charAt(from) === "}") {
      break;
    }

    // find next stop (semicolon for the end of line, colon for end of prop name, parenthesis for end of method name
    ({ index: ptr, found: match } = regExpClosestIndexOf(src, /;|:|\(/, ptr));

    // get name and modifiers
    let { name, modifiers } = getPropertyNoType(src, from, ptr);

    // method
    if (match === "(") {
      // find end of parameters declaration
      let end = findClosing(src, ptr, ROUND_BRACKETS);

      // find the colon to start searching for type
      params = parseParams(src, ptr + 1, end);

      let closing = regExpClosestIndexOf(src, /;|:/, end);

      ptr = closing.index + 1;

      if (closing.found === ";") {
        methods.push(buildField(modifiers, name, params));
        continue;
      }
    }
    // no type property
    else if (match === ";") {
      properties.push(buildField(modifiers, name));
      continue;
    }

    let { type, end: typeEnd } = getType(src, ptr + 1);
    ptr = src.indexOf(";", typeEnd);

    if (params) {
      methods.push(buildField(modifiers, name, params, type));
    }
    else {
      properties.push(buildField(modifiers, name, null, type));
    }
  }

  return { className, parent, properties, methods };
}

/**
 * Get field decorators
 */
function fieldDecoratorsAnalyzer({ definedAnnotations, decorators, annotations, className }): Replacer {
  return [
    new RegExp(`[\\s]*__decorate\\(\\[([\\W\\w]*?)], (${className}\\.prototype), "(.*?)", (.*?)\\);`, "g"),
    (_, definition, proto, name, descriptor) => {
      let usedDecorators: Array<Decorator> = [];
      let usedAnnotations: Array<Decorator> = [];

      definition = definition.trim();

      // get each decorator name and execution params
      for (let decors = split(definition, ",", true), i = 0, l = decors.length; i < l; i++) {
        let decor = decors[ i ];
        let ptr = decor.indexOf("(");
        let [name, params = undefined] = ptr !== -1 ? [
          decor.slice(0, ptr),
          decor.slice(ptr + 1, decor.length - 1)
        ] : [ decor ];
        if (definedAnnotations.indexOf(name) !== -1) {
          usedAnnotations.push({ name, params, descriptor, src: decor });
        }
        else {
          usedDecorators.push({ name, params, descriptor, src: decor });
        }
      }

      decorators[ name ] = usedDecorators;
      annotations[ name ] = usedAnnotations;

      if (usedDecorators.length === 0) {
        return "";
      }
      return `\n__decorate([${usedDecorators.map(n => n.src).toString()}], ${proto}, "${name}", ${descriptor});`
    }
  ];
}

/**
 * Get class decorators
 */
function classDecoratorsAnalyzer({ definedAnnotations, decorators, annotations, className, generatedName }): Replacer {
  return [
    new RegExp(`[\\s]*${className} = (?:.*? = )?__decorate\\(\\[([\\W\\w]*?)], (${className})\\);`, "g"),
    (_, definition) => {
      let usedDecorators: Array<Decorator> = [];
      let usedAnnotations: Array<Decorator> = [];

      definition = definition.trim();

      // get each decorator name and execution params
      for (let decors = split(definition, ",", true), i = 0, l = decors.length; i < l; i++) {
        let decor = decors[ i ];
        let ptr = decor.indexOf("(");
        let [name, params = undefined] = ptr !== -1 ? [
          decor.slice(0, ptr),
          decor.slice(ptr + 1, decor.length - 1)
        ] : [ decor ];
        if (definedAnnotations.indexOf(name) !== -1) {
          usedAnnotations.push({ name, params, src: decor });
        }
        else {
          usedDecorators.push({ name, params, src: decor });
        }
      }

      decorators[ "class" ] = usedDecorators;
      annotations[ "class" ] = usedAnnotations;

      if (usedDecorators.length === 0) {
        return "";
      }
      if (generatedName) {
        generatedName += " = ";
      }
      else {
        generatedName = "";
      }
      return `\n${className} = ${generatedName}__decorate([${usedDecorators.map(n => n.src)
        .toString()}], ${className});`
    }
  ];
}

/**
 * Get method bodies
 */
function methodsAnalyzer({ src, methodBodies, methods, isES6, className }): Replacer {
  let methodsList = methods.map(itm => itm.name).join("|");

  return [
    isES6
      ? new RegExp(`((${methodsList}))\\(.*?\\) {`, "g")
      : new RegExp(`(${className}.prototype.(${methodsList}) = function ?)\\(.*?\\) {`, "g"),
    (_, boiler, name, index) => {
      let end = findClosing(src, src.indexOf("{", index + boiler.length), OBJECT_BRACKETS);
      methodBodies[ name ] = src.slice(index + boiler.length, end + 1).trim();
      return _;
    }
  ];
}

/**
 * Get default values
 */
function defaultValueAnalyzer({ properties, values }): Replacer {
  return [
    new RegExp(`this\\.(${properties.map(itm => itm.name).join("|")}) = (.*);\\n`, "g"),
    (_, name, value) => values[ name ] = value
  ];
}

/**
 * Remove __extend helper from ES5
 */
function removeExtend({ className }): Replacer {
  return [
    new RegExp(`__extends(${className}, _super);`),
    ""
  ];
}

/**
 * Find class source start index, end index, generated helper name and flag if source is ES6 (class based)
 */
function findClassBody({ src, className }): { isES6: boolean; start: number; end: number; generatedName: string } {
  let matchES5 = src.match(new RegExp(`var ${className} = \\(function \\((?:_super)?\\) {`));
  let matchES6 = src.match(new RegExp(`(?:let (${className}[\\S]*) = )?class ${className}(?: extends .+?)? {`));
  let isES6;

  let start, end;
  let match;

  if (matchES5) {
    isES6 = false;
    match = matchES5;
  }
  else if (matchES6) {
    isES6 = true;
    match = matchES6;
  }
  else {
    throw new Error("no class found");
  }

  let { 0: line, 1: generatedName, index } = match;
  start = index;

  end = findClosing(src, start + line.length, OBJECT_BRACKETS);
  if (!isES6) {
    end = findClosing(src, src.indexOf("(", end), ROUND_BRACKETS);
  }
  end = src.indexOf(";", end);

  return { isES6, start, end, generatedName };
}

/**
 * Find constructor position
 */
function findConstructor({ isES6, className, src, classStart }): { start: number; end: number } {
  let constructorPattern = isES6 ? `constructor(` : `function ${className}(`;
  let start = src.indexOf(constructorPattern, classStart);
  let end = findClosing(src, start + constructorPattern.length - 1, ROUND_BRACKETS);
  end = src.indexOf("{", end);
  end = findClosing(src, end, OBJECT_BRACKETS);
  return { start, end };
}

/**
 * Parse JavaScript output to fetch default values, decorators, annotations, generated additional variable name and
 * pre-formatted JavaScript src
 *
 * @todo consider removing default values as an option
 * @todo parse default values using goTo function
 *
 * @param src String to parse
 * @param dtsData Data fetched from TypeScript declaration
 * @param options Options passed to parser
 * @param options.definedAnnotations Available design-time annotations
 *
 * @throws Error if no class was found
 *
 * @returns default values, decorators, annotations, generated additional variable name and pre-formatted JavaScript src
 */
export function parseJS(src: string, dtsData: DTSParsedData, options: JSParserOptions = <any> {}): JSParsedData {
  const { definedAnnotations = [] } = options;
  const { className, properties, methods } = dtsData;

  /********** declare result objects **********/
  const values = {};
  const methodBodies = {};
  const decorators = {};
  const annotations = {};

  /********** get class body position **********/
  const { isES6, start: classStart, end: classEnd, generatedName } = findClassBody({ src, className });

  /********** get constructor position **********/
  const { start: constructorStart, end: constructorEnd } = findConstructor({ isES6, className, src, classStart });

  /********** get default values **********/
  (<any> src)
    .slice(constructorStart + 1, constructorEnd)
    .replace(...defaultValueAnalyzer({ values, properties }));

  /********** get method bodies **********/
  (<any> src)
    .replace(...removeExtend({ className }))
    .replace(...methodsAnalyzer({ src, methodBodies, methods, isES6, className }));

  /********** get decorators and remove them if needed **********/
  let decorStart = src.indexOf("__decorate([", constructorEnd);
  let decorSrc = (<any> src
    .substr(decorStart))
    .replace(...fieldDecoratorsAnalyzer({ annotations, decorators, definedAnnotations, className }))
    .replace(...classDecoratorsAnalyzer({ generatedName, annotations, decorators, definedAnnotations, className }));

  // TODO: return classBody start/end data or update source in place
  return { generatedName, values, methodBodies, decorators, annotations, src: src.slice(0, decorStart) + decorSrc };
}
