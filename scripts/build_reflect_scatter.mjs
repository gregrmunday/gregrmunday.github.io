// Offline build only. Install pinned wabt@1.0.39 in a temporary directory, then
// pass its absolute package path. The browser fetches only the compiled WASM.
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const wabt=await require(process.argv[2]||'wabt')();
const input=new URL('./reflect_scatter.wat',import.meta.url);
const output=new URL('../assets/js/reflect/scatter.wasm',import.meta.url);
const module=wabt.parseWat(input.pathname,await readFile(input,'utf8'),{bulk_memory:true});
try{
 module.resolveNames();module.validate();
 const {buffer}=module.toBinary({canonicalize_lebs:true,write_debug_names:false});
 await WebAssembly.compile(buffer);
 await writeFile(output,buffer);
 console.log(`Compiled Gaussian scattering helper: ${buffer.byteLength} bytes`);
}finally{module.destroy();}
