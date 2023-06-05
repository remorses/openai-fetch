/** A function that converts from raw Completion response from OpenAI
 * into a nicer object which includes the first choice in response from OpenAI.
 */
type ResponseFactory<Raw, Nice> = (response: Raw) => Nice;

/**
 * A parser for the streaming responses from the OpenAI API.
 *
 * Conveniently shaped like an argument for WritableStream constructor.
 */
class OpenAIStreamParser<Raw, Nice> {
  private responseFactory: ResponseFactory<Raw, Nice>;
  onchunk?: (chunk: Nice) => void;
  onend?: () => void;

  constructor(responseFactory: ResponseFactory<Raw, Nice>) {
    this.responseFactory = responseFactory;
  }

  /**
   * Takes the ReadableStream chunks, produced by `fetch` and turns them into
   * `CompletionResponse` objects.
   * @param chunk The chunk of data from the stream.
   */
  write(chunk: Uint8Array): void {
    const decoder = new TextDecoder();
    const s = decoder.decode(chunk);
    s.split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .forEach((line) => {
        const pos = line.indexOf(':');
        const name = line.substring(0, pos);
        if (name !== 'data') return;
        const content = line.substring(pos + 1).trim();
        if (content.length == 0) return;
        if (content === '[DONE]') {
          this.onend?.();
          return;
        }
        try {
          const parsed = JSON.parse(content);
          this.onchunk?.(this.responseFactory(parsed));
        } catch (e) {
          console.error('Failed parsing streamed JSON chunk ${content}', e);
        }
      });
  }
}

/**
 * A transform stream that takes the streaming responses from the OpenAI API
 * and turns them into useful response objects.
 */
export class StreamCompletionChunker<Raw, Nice>
  implements TransformStream<Uint8Array, Nice>
{
  writable: WritableStream<Uint8Array>;
  readable: ReadableStream<Nice>;

  constructor(responseFactory: ResponseFactory<Raw, Nice>) {
    const parser = new OpenAIStreamParser(responseFactory);
    this.writable = new WritableStream(parser);
    this.readable = new ReadableStream({
      start(controller) {
        parser.onchunk = (chunk: Nice) => controller.enqueue(chunk);
        parser.onend = () => controller.close();
      },
    });
  }
}
