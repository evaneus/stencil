import * as d from '@declarations';
import { CompilerUpgrade, validateCollectionCompatibility } from '../collections/collection-compatibility';
import { logger, sys } from '@sys';


/**
 * Find all referenced types by a component and add them to the importDataObj and return the newly
 * updated importDataObj
 *
 * @param importDataObj key/value of type import file, each value is an array of imported types
 * @param cmpMeta the metadata for the component that is referencing the types
 * @param filePath the path of the component file
 * @param config general config that all of stencil uses
 */
export function updateReferenceTypeImports(importDataObj: d.TypesImportData, allTypes: Map<string, number>, cmp: d.ComponentCompilerMeta, filePath: string) {
  const updateImportReferences = updateImportReferenceFactory(allTypes, filePath);

  return [
    ...cmp.properties,
    ...cmp.events,
    ...cmp.methods,
  ]
  .filter(cmpProp => cmpProp.complexType && cmpProp.complexType.references)
  .reduce((obj, cmpProp) => {
    return updateImportReferences(obj, cmpProp.complexType.references);
  }, importDataObj);
}

function updateImportReferenceFactory(allTypes: Map<string, number>, filePath: string) {
  function getIncrementTypeName(name: string): string {
    const counter = allTypes.get(name);
    if (counter === undefined) {
      allTypes.set(name, 1);
      return name;
    }
    allTypes.set(name, counter + 1);
    return `${name}${counter}`;
  }

  return (obj: d.TypesImportData, typeReferences: { [key: string]: d.ComponentCompilerTypeReference }) => {
    Object.keys(typeReferences).map(typeName => {
      return [typeName, typeReferences[typeName]] as [string, d.ComponentCompilerTypeReference];
    }).forEach(([typeName, type]) => {
      let importFileLocation: string;

      // If global then there is no import statement needed
      if (type.location === 'global') {
        return;

      // If local then import location is the current file
      } else if (type.location === 'local') {
        importFileLocation = filePath;

      } else if (type.location === 'import') {
        importFileLocation = type.path;
      }

      // If this is a relative path make it absolute
      if (importFileLocation.startsWith('.')) {
        importFileLocation =
          sys.path.resolve(
            sys.path.dirname(filePath),
            importFileLocation
          );
      }

      obj[importFileLocation] = obj[importFileLocation] || [];

      // If this file already has a reference to this type move on
      if (obj[importFileLocation].find(df => df.localName === typeName)) {
        return;
      }

      const newTypeName = getIncrementTypeName(typeName);
      obj[importFileLocation].push({
        localName: typeName,
        importName: newTypeName
      });
    });

    return obj;
  };
}


export async function getCollectionsTypeImports(compilerCtx: d.CompilerCtx, includeIntrinsicElements = false) {
  const collections = compilerCtx.collections.map(collection => {
    const upgrades = validateCollectionCompatibility(collection);
    const shouldIncludeLocalIntrinsicElements = includeIntrinsicElements && upgrades.indexOf(CompilerUpgrade.Add_Local_Intrinsic_Elements) !== -1;
    return getCollectionTypesImport(compilerCtx, collection, shouldIncludeLocalIntrinsicElements);
  });

  const collectionTypes = await Promise.all(collections);
  return collectionTypes;
}


async function getCollectionTypesImport(compilerCtx: d.CompilerCtx, collection: d.Collection, includeIntrinsicElements = false) {
  let typeImport = null;

  try {
    const collectionDir = collection.moduleDir;
    const collectionPkgJson = sys.path.join(collectionDir, 'package.json');

    const pkgJsonStr = await compilerCtx.fs.readFile(collectionPkgJson);
    const pkgData: d.PackageJsonData = JSON.parse(pkgJsonStr);

    if (pkgData.types && pkgData.collection) {
      typeImport = {
        pkgName: pkgData.name,
        includeIntrinsicElements
      };
    }

  } catch (e) {
    logger.debug(`getCollectionTypesImport: ${e}`);
  }

  if (typeImport == null) {
    logger.debug(`unabled to find "${collection.collectionName}" collection types`);
  }

  return typeImport;
}