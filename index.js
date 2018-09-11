const path = require('path');
const fs = require('fs');
const mkdirp = require('mkdirp');
const _ = require('lodash');

// Regex to lookup class values from the HTML files
const htmlLookupRegex = /(?:(\bclass|className\b)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^"'<>\s]+))\s*)+/g;

// Configuration variables
let config = {};
let lazyHtml = ''; // `HTML` string when running in lazy generation
let lazyPaths = []; // `paths` when running in lazy generation
const defaults = {
  newLineChar: '\n',
  tabSpacing: 4,
  outputPath: '',
  minifyOutput: false,
  setImportant: false,
  classPrefix: '',
};

/**
 * Mapping for the numerical properties to their respective CSS property. Later on we may
 * have another object for full property values i.e. pos-r for position relative etc.
 *
 * @type {Object}
 */
const propertyMapping = {
  /**
   * Regex to check if some property value is tailorable for any of the properties below.
   * @note The regex only matches the numerical valued properties. It will be modified later on
   *       to support other properties as well e.g. pos-r: "position: relative" etc.
   *
   * @type {RegExp}
   */
  // regex: /(^[a-z]{1,23})-(.{3}|.{6})$/,
  getRegex: config => new RegExp(`(^${config.classPrefix}[a-z]{1,23})-(.{3}|.{6})$`),

  /**
   * Aliases mapping to their relevant CSS properties
   */
  color: 'color',
  bgcolor: 'background-color',
  bdcolor: 'border-color',
};

/**
 * Gets files from the passed path recursively
 *
 * @param dirPath      Path to get the files from
 * @param callback  Function which will be called for every found file
 */
const getFiles = (dirPath, callback) => {
  const files = fs.readdirSync(dirPath);
  files.forEach(file => {
    const fileName = path.join(dirPath, file);
    const stat = fs.lstatSync(fileName);

    if (stat.isDirectory()) {
      getFiles(fileName, callback); //recurse
    } else {
      callback(fileName);
    }
  });
};

/**
 * Extracts the attribute values from the passed HTML content
 *
 * @param attrRegex
 * @param htmlContent
 * @returns {Array}
 */
const extractAttributeValues = (attrRegex, htmlContent) => {
  const matches = [];
  let match;

  do {
    match = attrRegex.exec(htmlContent);

    if (match) {
      let foundMatch = match[2] || match[3] || match[4];
      foundMatch && matches.push(foundMatch);
    }
  } while (match);

  return _.uniq(matches);
};

/**
 * Gets the mapping for the
 *
 * @param actualUnit
 * @returns {string}
 */
const getUnit = actualUnit => {
  actualUnit = actualUnit || '';
  actualUnit = actualUnit.trim();

  return unitMapping[actualUnit] === undefined ? unitMapping.default : unitMapping[actualUnit];
};

/**
 * Gets the mapped CSS from the provided property if possible; Otherwise null
 *
 * @param property
 * @returns {null|Object}
 */
const getMappedCss = property => {
  const pieces = property.match(propertyMapping.getRegex(config));
  const cssProperty = pieces && propertyMapping[(pieces[1] || '').replace(config.classPrefix, '')];

  return (
    cssProperty && {
      selector: '.' + property,
      property: cssProperty,
      value: '#' + pieces[2] + (config.setImportant ? ' !important' : ''),
    }
  );
};

/**
 * Generates the CSS from the extracted attribute values
 *
 * @param extractedValues
 * @returns {Object}
 */
const generateCss = extractedValues => {
  const tabSpacing = _.repeat(' ', config.tabSpacing);
  const tailoredCss = {
    minified: '',
    formatted: '',
    object: {},
  };

  // For each of the extracted attribute values, parse each value
  extractedValues.forEach(function(attrValue) {
    attrValue = attrValue.replace(/\s+/g, ' ');
    const valueItems = attrValue.split(' ');

    // Since each value can have multiple properties (e.g. `p10 mt40`)
    // Split each value and iterate to generate any possible CSS
    valueItems.forEach(function(valueItem) {
      const css = getMappedCss(valueItem);
      if (!css) {
        return;
      }

      // Assemble CSS in the form of minified content, formatted content and object
      tailoredCss['minified'] += css.selector + '{' + css.property + ':' + css.value + ';}';
      tailoredCss['formatted'] +=
        css.selector +
        ' {' +
        config.newLineChar +
        tabSpacing +
        css.property +
        ': ' +
        css.value +
        ';' +
        config.newLineChar +
        '}' +
        config.newLineChar +
        config.newLineChar;

      tailoredCss['object'][css.selector] = {
        properties: [
          {
            property: css.property,
            value: css.value,
          },
        ],
      };
    });
  });

  return tailoredCss;
};

/**
 * Gets the file content if it is an HTML file
 *
 * @param filePath
 * @returns {string}
 */
const readHtmlFile = filePath => {
  const extension = path.extname(filePath) || '';
  let html = '';

  if (extension.toLowerCase() === '.html') {
    html = fs.readFileSync(filePath);
  }

  return html;
};

/**
 * Gets the HTML content from the passed path
 *
 * @param location
 * @returns {string}
 */
const pathToHtml = location => {
  if (!_.isString(location)) {
    throw 'Error! pathToHtml: Location must be string ' + typeof location + ' given';
  }

  let htmlContent = '';
  const lstat = fs.lstatSync(location);

  if (lstat.isDirectory()) {
    getFiles(location, function(filePath) {
      htmlContent += readHtmlFile(filePath);
    });
  } else if (lstat.isFile()) {
    htmlContent += readHtmlFile(location);
  }

  return htmlContent;
};

/**
 * Creates the output file using the generated CSS
 * @param css
 */
const createOutputFile = css => {
  if (!css || !config.outputPath) {
    return;
  }

  const contents = config.minifyOutput ? css.minified : css.formatted;
  const outputPath = config.outputPath;

  if (!_.endsWith(outputPath, '.css')) {
    throw 'Error! Full output path is required including css filename e.g. /assets/css/tailored.css';
  }

  mkdirp.sync(path.dirname(outputPath));
  fs.writeFileSync(outputPath, contents);
};

/**
 * Generates HTML from the given paths
 *
 * @param paths
 * @returns {string}
 */
const pathsToHtml = paths => {
  let htmlContent = '';

  if (_.isArray(paths)) {
    paths.forEach(location => {
      htmlContent += pathToHtml(location);
    });
  } else if (_.isString(paths)) {
    htmlContent += pathToHtml(paths);
  }

  return htmlContent;
};

/**
 * Updates settings if required during the CSS generation
 *
 * @param options
 */
const updateOptions = options => {
  const tempDefaults = _.cloneDeep(defaults);

  options = options || {};
  config = _.merge(tempDefaults, options);
};

module.exports = {
  /**
   * Pushes HTML for the lazy generation
   *
   * @param htmlContent
   */
  pushHtml: function(htmlContent) {
    lazyHtml += htmlContent;
  },

  /**
   * Pushes path for the lazy generation
   *
   * @param path
   */
  pushPath: function(path) {
    lazyPaths.push(path);
  },

  /**
   * Generates CSS from the lazily set content
   *
   * @returns {{}|{minified: '', formatted: '', object: {}}}
   */
  generateLazy: function(options) {
    if (_.isEmpty(lazyHtml) && _.isEmpty(lazyPaths)) {
      throw 'Error! No HTML or path given for lazy generation';
    }

    updateOptions(options);

    let htmlContent = '';

    htmlContent += pathsToHtml(lazyPaths);
    htmlContent += lazyHtml;

    // Reset lazy variables
    lazyPaths = '';
    lazyHtml = [];

    return this.generateCss(htmlContent);
  },

  /**
   * Generate CSS from HTML string
   *
   * @param htmlContent
   * @param options
   * @returns {{}|{minified: '', formatted: '', object: {}}}
   */
  generateCss: function(htmlContent, options) {
    updateOptions(options);

    const extractedValues = extractAttributeValues(htmlLookupRegex, htmlContent);
    if (!extractedValues || extractedValues.length === 0) {
      return {
        minified: '',
        formatted: '',
        object: {},
      };
    }

    let generatedCss = generateCss(extractedValues);
    createOutputFile(generatedCss);

    return generatedCss;
  },

  /**
   * Generate CSS for any HTML files at provided paths
   *
   * @param paths Array|string
   * @param options
   * @returns {*|string}
   */
  generatePathCss: function(paths, options) {
    if (_.isEmpty(paths)) {
      throw 'Error! path is required';
    }

    return this.generateCss(pathsToHtml(paths), options);
  },
};
