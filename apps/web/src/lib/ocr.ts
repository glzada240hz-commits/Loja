/**
 * Lê o texto de uma imagem (print da conversa) no próprio aparelho, com Tesseract (sem serviço externo e sem
 * custo). Os arquivos do leitor ficam em /ocr e só são baixados na primeira leitura.
 */
export async function readImageText(image: Blob, onProgress?: (pct: number) => void): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error('O leitor demorou demais. Tente de novo ou digite os dados.')), 120_000);
  });
  try {
    return await Promise.race([run(image, onProgress), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function run(image: Blob, onProgress?: (pct: number) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('por', 1 /* LSTM */, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/',
    langPath: '/ocr',
    gzip: true,
    workerBlobURL: false,
    errorHandler: () => undefined,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(Math.round(m.progress * 100));
    },
  });
  try {
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
