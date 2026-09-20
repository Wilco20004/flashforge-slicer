import type { TriangleMesh } from './mesh';
import { parseSTL } from './stl';
import { parseOBJ } from './obj';
import { parse3MF } from './threemf';

export const SUPPORTED_EXTENSIONS = ['.stl', '.3mf', '.obj'];

export async function loadModelFile(file: File): Promise<TriangleMesh[]> {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  const buffer = await file.arrayBuffer();
  switch (ext) {
    case '.stl':
      return [parseSTL(buffer, file.name)];
    case '.obj':
      return [parseOBJ(new TextDecoder().decode(buffer), file.name)];
    case '.3mf':
      return parse3MF(buffer, file.name);
    default:
      throw new Error(`Unsupported file type "${ext}". Use STL, 3MF or OBJ.`);
  }
}
