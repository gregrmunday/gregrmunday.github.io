import { simulate } from './model.mjs';
self.onmessage = ({ data: { id, config } }) => {
  try {
    const result = simulate(config);
    const buffers = Object.values(result).filter(value => ArrayBuffer.isView(value)).map(value => value.buffer);
    self.postMessage({ id, result }, buffers);
  } catch (error) { self.postMessage({ id, error: error.message }); }
};
