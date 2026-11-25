/**
 * Una terminal de verdad para los tests de pantalla: interpreta lo que escriben @inquirer y ARCLI (texto, cortes de
 * linea, mover el cursor y borrar) y da lo que se ve, con su historial. Sin colores. Una secuencia que no conoce es un
 * error del test, no texto.
 */
export class VirtualTerminal {
  private column = 0;
  /** El historial y, al final, las `rows` lineas que se ven. */
  private readonly lines: string[][] = [[]];
  private row = 0;

  public constructor(
    private readonly columns: number,
    private readonly rows: number,
  ) {}

  /** El historial y lo que se ve, sin los espacios del final de cada linea. */
  public history(): string[] {
    return this.lines.map((line) =>
      Array.from(line, (char) => char ?? ' ')
        .join('')
        .trimEnd(),
    );
  }

  /** Lo que se ve: las ultimas `rows` lineas. */
  public screen(): string[] {
    return this.history().slice(-this.rows);
  }

  public write(text: string): void {
    // eslint-disable-next-line no-control-regex
    for (const [token] of text.matchAll(/\u001B\[[0-?]*[ -/]*[@-~]|\r|\n|[\s\S]/gu)) {
      this.apply(token);
    }
  }

  private apply(token: string): void {
    if (token.startsWith('\u001B')) {
      this.applySequence(token);
    } else if (token === '\r') {
      this.column = 0;
    } else if (token === '\n') {
      this.column = 0;
      this.lineFeed();
    } else {
      if (this.column >= this.columns) {
        this.column = 0;
        this.lineFeed();
      }

      this.line()[this.column] = token;
      this.column += 1;
    }
  }

  private applySequence(sequence: string): void {
    const body = sequence.slice(2, -1);
    const count = Number(body || 1);

    switch (sequence.slice(-1)) {
      case 'A':
        // El cursor no sale de lo que se ve: lo que ya se desplazo no se puede borrar.
        this.row = Math.max(this.lines.length - this.rows, 0, this.row - count);
        break;
      case 'B':
        this.row = Math.min(this.lines.length - 1, this.row + count);
        break;
      case 'C':
        this.column = Math.min(this.columns - 1, this.column + count);
        break;
      case 'D':
        this.column = Math.max(0, this.column - count);
        break;
      case 'G':
        this.column = count - 1;
        break;
      case 'K':
        if (body === '2') {
          this.lines[this.row] = [];
        } else {
          this.line().splice(this.column);
        }

        break;
      case 'h':
      case 'l':
      case 'm':
        break;
      default:
        throw new Error(`Secuencia desconocida: ${JSON.stringify(sequence)}`);
    }
  }

  private line(): string[] {
    return (this.lines[this.row] ??= []);
  }

  private lineFeed(): void {
    this.row += 1;

    if (this.row === this.lines.length) {
      this.lines.push([]);
    }
  }
}
