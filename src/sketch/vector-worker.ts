import { booleanPaths } from '@aether/sketch';
self.onmessage=event=>{try{const {paths,operation,tolerance}=event.data;self.postMessage({path:booleanPaths(paths,operation,tolerance)});}catch(error){self.postMessage({error:(error as Error).message});}};
