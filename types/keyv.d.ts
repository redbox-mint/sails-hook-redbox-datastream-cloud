// Type override for keyv package to fix async modifier errors
declare module 'keyv' {
  interface CompressionAdapter {
    compress(value: any, options?: any): Promise<any>;
    decompress(value: any, options?: any): Promise<any>;
    serialize(value: any): Promise<any>;
    deserialize(value: any): Promise<any>;
  }
  
  // Re-export everything else from the original keyv types
  export * from 'keyv/src/index';
}