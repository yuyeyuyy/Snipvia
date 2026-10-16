const tags = ['<think>', '</think>', '<analysis>', '</analysis>'];

/** Incrementally removes reasoning blocks, including tags split across SSE chunks. */
export class VisibleTextStream {
  private pending = '';
  private readonly hidden: string[] = [];
  push(text: string): string {
    this.pending += text;
    let visible = '';
    while (this.pending) {
      const match = /<\/?(think|analysis)>/i.exec(this.pending);
      if (match) {
        if (!this.hidden.length) visible += this.pending.slice(0, match.index);
        const name = match[1].toLowerCase();
        if (match[0][1] !== '/') this.hidden.push(name);
        else if (this.hidden.at(-1) === name) this.hidden.pop();
        this.pending = this.pending.slice(match.index + match[0].length);
        continue;
      }
      // Hold only a possible tag prefix, never an unbounded hidden reasoning block.
      let held = 0;
      const lower = this.pending.toLowerCase();
      for (const tag of tags) for (let size = 1; size < tag.length; size++) {
        if (lower.endsWith(tag.slice(0, size))) held = Math.max(held, size);
      }
      if (!this.hidden.length) visible += this.pending.slice(0, this.pending.length - held);
      this.pending = held ? this.pending.slice(-held) : '';
      break;
    }
    return visible;
  }
  finish(): string {
    // An unfinished reasoning tag remains hidden; ordinary partial markup is preserved.
    const remaining = !this.hidden.length && !tags.some((tag) => tag.startsWith(this.pending.toLowerCase())) ? this.pending : '';
    this.pending = ''; this.hidden.length = 0;
    return remaining;
  }
}
