export const isDrawingFile = (name: string) => /\.(acdrw|acdrawing)$/i.test(name);
export const isPartFile = (name: string) => /\.(acpart|cadpart)$/i.test(name);
export const isProjectFile = (name: string) =>
  /\.(acad|acasm|aether)$/i.test(name);
