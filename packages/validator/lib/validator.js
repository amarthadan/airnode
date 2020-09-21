'use strict';

const fs = require('fs');
const apiSpecs = JSON.parse(fs.readFileSync('specs/api.json', 'utf8'));
const oisSpecs = JSON.parse(fs.readFileSync('specs/ois.json', 'utf8'));
const endpointsSpecs = JSON.parse(fs.readFileSync('specs/endpoints.json', 'utf8'));

function getLastParamName(paramPath) {
  const lastDotIndex = paramPath.lastIndexOf('.');
  let paramName = paramPath;

  if (lastDotIndex >= 0) {
    paramName = paramPath.slice(lastDotIndex + 1);
  }

  return paramName;
}

function replaceConditionalMatch(match, specs) {
  let parsedSpecs = {};

  for (const key of Object.keys(specs)) {
    if (key === '__conditions') {
      continue;
    }

    let newKey = key.replace(/__match/g, match);
    parsedSpecs[newKey] = typeof specs[key] === 'string' ? specs[key].replace(/__match/g, match) : replaceConditionalMatch(match, specs[key]);
  }

  return parsedSpecs;
}

function checkRedundancy(nonRedundant, specs, paramPath, messages) {
  if (typeof specs === 'object') {
    if (Array.isArray(specs)) {
      for (let i = 0; i < specs.length; i++) {
        if (nonRedundant[i]) {
          checkRedundancy(nonRedundant[i], specs[i], `${paramPath}[${i}]`, messages);
        }
      }
    } else {
      for (let param of Object.keys(specs)) {
        if (nonRedundant[param]) {
          checkRedundancy(nonRedundant[param], specs[param], `${paramPath}${paramPath ? '.' : ''}${param}`, messages);
        } else {
          if (Object.keys(nonRedundant).includes('__noCheck')) {
            continue;
          }

          messages.push({ level: 'warning', message: `Extra field: ${paramPath}${paramPath ? '.' : ''}${param}` });
        }
      }
    }
  }
}

function insertNonRedundantParam(param, specsStruct, nonRedundantParams, specs) {
  if (!nonRedundantParams[param]) {
    if (typeof specsStruct === 'object' && typeof specsStruct[param] === 'object') {
      if ('__arrayItem' in (specsStruct[param] || {}) ) {
        nonRedundantParams[param] = [];
      } else if (('__any' in (specsStruct[param] || {})) && Array.isArray(specs)) {
        nonRedundantParams[param] = [];
      } else {
        nonRedundantParams[param] = {};
      }
    } else {
      nonRedundantParams[param] = {};
    }
  }
}

function findAnyValidParam(specs, specsRoot, specsStruct, paramPath, nonRedundantParams, nonRedundantParamsRoot) {
  if (!specs) {
    return false;
  }

  let validParamFound = false;

  if (Array.isArray(specs)) {
    for (let paramIndex = 0; paramIndex < specs.length; paramIndex++) {
      let nonRedundantParamsCopy = {};

      if (nonRedundantParams[paramIndex]) {
        nonRedundantParamsCopy = JSON.parse(JSON.stringify(nonRedundantParams[paramIndex]));
      } else {
        nonRedundantParams.push({});
      }

      let result = validateSpecs(specs[paramIndex], specsStruct, paramPath, specsRoot, nonRedundantParams[nonRedundantParams.length - 1], nonRedundantParamsRoot);

      if (!result.messages.length) {
        validParamFound = true;
        break;
      }

      nonRedundantParams[paramIndex] = nonRedundantParamsCopy;
    }
  } else {
    for (const paramKey of Object.keys(specs)) {
      let nonRedundantParamsCopy = {};

      if (nonRedundantParams[paramKey]) {
        nonRedundantParamsCopy = JSON.parse(JSON.stringify(nonRedundantParams[paramKey]));
      } else {
        insertNonRedundantParam(paramKey, specsStruct, nonRedundantParams, specs[paramKey]);
      }

      let result = validateSpecs(specs[paramKey], specsStruct, paramPath, specsRoot, nonRedundantParams[paramKey], nonRedundantParamsRoot);

      if (!result.messages.length) {
        validParamFound = true;
        break;
      }

      nonRedundantParams[paramKey] = nonRedundantParamsCopy;
    }
  }

  return validParamFound;
}

function validateSpecs(specs, specsStruct, paramPath, specsRoot, nonRedundantParams, nonRedundantParamsRoot, paramPathPrefix = '') {
  let messages = [];
  let valid = true;

  for (const key of Object.keys(specsStruct)) {
    if (key === '__conditions') {
      for (const condition of specsStruct[key]) {
        if (condition['__if']) {
          const paramName = Object.keys(condition['__if'])[0];
          const paramValue = condition['__if'][paramName];
          const thenParamName = Object.keys(condition['__then'])[0];

          if (paramName === '__this') {
            for (const thisName of Object.keys(specs)) {
              if (!thisName) {
                continue;
              }

              let matches = thisName.match(new RegExp(paramValue, 'g'));

              if (matches) {
                for (let param of matches) {
                  let nonRedundantParamsCopy = {};
                  let parsedSpecs = replaceConditionalMatch(param, condition['__then']);

                  if (nonRedundantParams[thisName]) {
                    nonRedundantParamsCopy = JSON.parse(JSON.stringify(nonRedundantParams[thisName]));
                  } else {
                    insertNonRedundantParam(thisName, parsedSpecs, nonRedundantParams, specs[thisName]);
                  }

                  let result = validateSpecs(specs[thisName], parsedSpecs, `${paramPath}${paramPath ? '.' : ''}${thisName}`, specsRoot, nonRedundantParams[thisName], nonRedundantParamsRoot, paramPathPrefix);

                  if (!result.valid) {
                    if (Object.keys(nonRedundantParamsCopy).length) {
                      nonRedundantParams[thisName] = nonRedundantParamsCopy;
                    } else {
                      delete nonRedundantParams[thisName];
                    }
                    
                    messages.push({ level: 'error', message: `Condition in ${paramPath}${paramPath ? '.' : ''}${thisName} is not met with ${param}` });
                    valid = false;
                  }
                }
              }
            }
          } else if (specs[paramName]) {
            if (specs[paramName].match(new RegExp(paramValue))) {
              if (specs[thenParamName]) {
                let nonRedundantParamsCopy = {};

                if (nonRedundantParams[thenParamName]) {
                  nonRedundantParamsCopy = JSON.parse(JSON.stringify(nonRedundantParams[thenParamName]));
                } else {
                  insertNonRedundantParam(thenParamName, condition['__then'][thenParamName], nonRedundantParams, specs[thenParamName]);
                }

                if (!Object.keys(condition['__then'][thenParamName]).length) {
                  continue;
                }

                let result = validateSpecs(specs[thenParamName], condition['__then'][thenParamName], `${paramPath}${paramPath ? '.' : ''}${thenParamName}`, specsRoot, nonRedundantParams[thenParamName], nonRedundantParamsRoot, paramPathPrefix);
                messages.push(...result.messages);

                if (!result.valid) {
                  let keepRedundantParams = true;

                  for (let message of result.messages) {
                    if (message.message.startsWith('Missing parameter ')) {
                      keepRedundantParams = false;
                    }
                  }

                  if (!keepRedundantParams) {
                    if (Object.keys(nonRedundantParamsCopy).length) {
                      nonRedundantParams[thenParamName] = nonRedundantParamsCopy;
                    } else {
                      delete nonRedundantParams[thenParamName];
                    }
                  }

                  valid = false;
                }
              } else if (thenParamName === '__any') {
                if (!findAnyValidParam(specs, specsRoot, condition['__then']['__any'], paramPath, nonRedundantParams, nonRedundantParamsRoot)) {
                  messages.push({ level: 'error', message: `Required conditions not met in ${paramPath}`});
                  valid = false;
                }
              } else {
                valid = false;
                messages.push({ level: 'error', message: `Missing parameter ${paramPath}${(paramPath && thenParamName) ? '.' : ''}${thenParamName}`});
              }
            }
          }
        } else if (condition['__require']) {
          for (let requiredParam of Object.keys(condition['__require'])) {
            let workingDir = specs;
            let requiredPath = '';
            let currentDir = paramPath;
            let nonRedundantWD = nonRedundantParams;

            let thisName = getLastParamName(paramPath);
            requiredParam = requiredParam.replace(/__this_name/g, thisName);

            if (requiredParam[0] === '/') {
              requiredParam = requiredParam.slice(1);
              workingDir = specsRoot;
              currentDir = '';
              nonRedundantWD = nonRedundantParamsRoot;
            }

            requiredPath = requiredParam;

            while (requiredPath.length) {
              const dotIndex = requiredPath.indexOf('.');
              let paramName = requiredPath;

              if (dotIndex > 0) {
                paramName = requiredPath.substr(0, dotIndex);
              }

              currentDir = `${currentDir}${currentDir ? '.' : ''}${paramName}`;
              requiredPath = requiredPath.replace(paramName, '');

              if (requiredPath.startsWith('.')) {
                requiredPath = requiredPath.replace('.', '');
              }

              let index = 0;
              let indexMatches = paramName.match(/(?<=\[)[\d]+(?=])/);

              if (indexMatches && indexMatches.length) {
                index = parseInt(indexMatches[0]);
              }

              if (!workingDir[paramName]) {
                valid = false;
                messages.push({ level: 'error', message: `Missing parameter ${paramPathPrefix ? `${paramPathPrefix}.` : ''}${currentDir}${(currentDir && requiredPath) ? '.' : ''}${requiredPath}`});
                break;
              }

              if (!nonRedundantWD[paramName]) {
                if (typeof workingDir === 'object') {
                  nonRedundantWD[paramName] = Array.isArray(workingDir[paramName]) ? [] : {};
                } else {
                  nonRedundantWD[paramName] = {};
                }
              }

              nonRedundantWD = nonRedundantWD[paramName];
              workingDir = workingDir[paramName];

              if (index) {
                if (!workingDir[index]) {
                  valid = false;
                  messages.push({ level: 'error', message: `Array out of bounds, attempted to access element on index ${index} in ${paramPathPrefix ? `${paramPathPrefix}.` : ''}${currentDir}`}, paramPathPrefix);
                  break;
                }

                workingDir = workingDir[index];

                nonRedundantWD.push({});
                nonRedundantWD = nonRedundantWD[nonRedundantWD.size() - 1];
              }
            }
          }
        }
      }

      continue;
    }

    if (key === '__regexp') {
      if (typeof specs !== 'string' || !specs.match(new RegExp(specsStruct[key]))) {
        let level = 'warning';

        if (specsStruct['__level']) {
          level = specsStruct['__level'];

          if (level === 'error') {
            valid = false;
          }
        }

        messages.push({ level, message: `${paramPath} is not formatted correctly` });
      }

      continue;
    }

    if (key === '__keyRegexp') {
      for (const item of Object.keys(specs)) {
        if (!item.match(new RegExp(specsStruct[key]))) {
          messages.push({ level: 'error', message: `Key ${item} in ${paramPath}${paramPath ? '.' : ''}${item} is formatted incorrectly` });
        }
      }

      continue;
    }

    if (key === '__maxSize') {
      if (specsStruct[key] < specs.length) {
        messages.push({ level: 'error', message: `${paramPath} must contain ${specsStruct[key]} or less items` });
        valid = false;
      }

      continue;
    }

    if (key === '__arrayItem') {
      if (!nonRedundantParams) {
        nonRedundantParams = [];
      }

      for (let i = 0; i < specs.length; i++) {
        nonRedundantParams.push({});
        let result = validateSpecs(specs[i], specsStruct[key], `${paramPath}[${i}]`, specsRoot, nonRedundantParams[i], nonRedundantParamsRoot, paramPathPrefix);
        messages.push(...result.messages);

        if (!result.valid) {
          valid = false;
        }
      }

      continue;
    }

    if (key === '__objectItem') {
      for (const item of Object.keys(specs)) {
        insertNonRedundantParam(item, specsStruct, nonRedundantParams, specs[item]);

        let result = validateSpecs(specs[item], specsStruct[key], `${paramPath}${paramPath ? '.' : ''}${item}`, specsRoot, nonRedundantParams[item], nonRedundantParamsRoot, paramPathPrefix);
        messages.push(...result.messages);

        if (!result.valid) {
          valid = false;
        }
      }

      continue;
    }

    if (key === '__optional') {
      for (const optionalItem of Object.keys(specsStruct[key])) {
        for (const item of Object.keys(specs)) {
          if (item === optionalItem) {
            insertNonRedundantParam(item, specsStruct[key], nonRedundantParams, specs[item]);

            let result = validateSpecs(specs[item], specsStruct[key][item], `${paramPath}${paramPath ? '.' : ''}${item}`, specsRoot, nonRedundantParams[item], nonRedundantParamsRoot, paramPathPrefix);
            messages.push(...result.messages);

            if (!result.valid) {
              valid = false;
            }
          }
        }
      }

      continue;
    }

    if (key === '__level') {
      continue;
    }

    if (key === '__any') {
      if (!findAnyValidParam(specs, specsRoot, specsStruct[key], paramPath, nonRedundantParams, nonRedundantParamsRoot)) {
        messages.push({ level: 'error', message: `Required conditions not met in ${paramPath}`});
        valid = false;
      }

      continue;
    }

    if (key === '__apiSpecs') {
      let nonRedundant = {};
      let result = validateSpecs(specs, apiSpecs, paramPath, specs, nonRedundant, nonRedundant, paramPath);
      messages.push(...result.messages);

      if (!result.valid) {
        valid = false;
      }

      nonRedundantParams['__noCheck'] = {};

      continue;
    }

    if (key === '__endpointsSpecs') {
      let nonRedundant = [];
      let result = validateSpecs(specs, endpointsSpecs, paramPath, specs, nonRedundant, nonRedundant, paramPath);
      messages.push(...result.messages);

      if (!result.valid) {
        valid = false;
      }

      nonRedundantParams['__noCheck'] = {};

      continue;
    }

    if (!specs[key]) {
      messages.push({ level: 'error', message: `Missing parameter ${paramPath}${(paramPath && key) ? '.' : ''}${key}`});
      valid = false;

      continue;
    }

    insertNonRedundantParam(key, specsStruct, nonRedundantParams, specs[key]);

    if (!Object.keys(specsStruct[key]).length) {
      continue;
    }

    let result = validateSpecs(specs[key], specsStruct[key], `${paramPath}${paramPath ? '.' : ''}${key}`, specsRoot, nonRedundantParams[key], nonRedundantParamsRoot, paramPathPrefix);
    messages.push(...result.messages);

    if (!result.valid) {
      valid = false;
    }
  }

  if (specs === specsRoot) {
    checkRedundancy(nonRedundantParamsRoot, specs, paramPath, messages);
  }

  return { valid, messages };
}

function isApiSpecsValid(specs) {
  let parsedSpecs;
  let nonRedundant = {};

  try {
    parsedSpecs = JSON.parse(specs);
  } catch (e) {
    return { valid: false, messages: [{ level: 'error', message: `${e.name}: ${e.message}` }] };
  }

  return validateSpecs(parsedSpecs, apiSpecs, '', parsedSpecs, nonRedundant, nonRedundant);
}

function isEndpointsValid(specs) {
  let parsedSpecs;
  let nonRedundant = [];

  try {
    parsedSpecs = JSON.parse(specs);
  } catch (e) {
    return { valid: false, messages: [{ level: 'error', message: `${e.name}: ${e.message}` }] };
  }

  return validateSpecs(parsedSpecs, endpointsSpecs, '', parsedSpecs, nonRedundant, nonRedundant);
}

function isOisValid(specs) {
  let parsedSpecs;
  let nonRedundant = {};

  try {
    parsedSpecs = JSON.parse(specs);
  } catch (e) {
    return { valid: false, messages: [{ level: 'error', message: `${e.name}: ${e.message}` }] };
  }

  return validateSpecs(parsedSpecs, oisSpecs, '', parsedSpecs, nonRedundant, nonRedundant);
}

module.exports = { isApiSpecsValid, isEndpointsValid, isOisValid };
