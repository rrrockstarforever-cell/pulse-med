// PDF worker configuration
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Set worker path for Electron
GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href;
