/** CAD packaging names; format identifiers remain stable for backward compatibility. */
export const CAD_PROJECT_EXTENSION = ".acad";
export const CAD_ASSEMBLY_EXTENSION = ".acasm";
export const CAD_DRAWING_EXTENSION = ".acdrw";
export const isDrawingFile = (name: string) => /\.(acdrw|acdrawing)$/i.test(name);
export const isPartFile = (name: string) => /\.(acpart|cadpart)$/i.test(name);
export const isProjectFile = (name: string) =>
  /\.(acad|acasm|aether)$/i.test(name);
export const isCADFile = (name: string) =>
  isPartFile(name) || isProjectFile(name) || isDrawingFile(name) || /\.(step|stp)$/i.test(name);
