// 日本語全文検索のトークナイザ（本要件の核）。
// 二系統設計:
//   - CJK（かな/カナ/漢字）連なり → bigram(2-gram)
//   - 英数字連なり（型番など "RAS-X28R"）→ 単語単位のまま（bigramに混ぜない）＋ prefix検索対象
// index/query の双方で同一関数を使う（MiniSearch に tokenize として渡す）。

// CJK系文字クラス（\u エスケープで明示）:
//   ぀-ヿ ひらがな+カタカナ(長音記号含む)
//   ㇰ-ㇿ カタカナ拡張
//   㐀-䶿 CJK拡張A / 一-鿿 CJK統合漢字 / 豈-﫿 互換漢字
//   ｦ-ﾟ 半角カタカナ
// 英数字は a-z0-9（normalize で小文字化・全角→半角済みの前提）。
const SEGMENT_RE =
  /[぀-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]+|[a-z0-9]+/g;

const ALNUM_HEAD = /[a-z0-9]/;

/**
 * 長さ保存の正規化。全角ASCII(U+FF01–FF5E)→半角、英字小文字化、全角スペース→半角。
 * NFKC を使わない理由: 濁点合成などで文字数が変わり、スニペットの一致位置マッピングが崩れるため。
 * 1文字→1文字を厳守し、正規化後インデックスを原文にそのまま使えるようにする。
 */
export function normalize(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0).toLowerCase(); // 全角ASCII → 半角(小文字)
    } else if (code === 0x3000) {
      out += ' '; // 全角スペース → 半角
    } else if (code >= 0x41 && code <= 0x5a) {
      out += String.fromCharCode(code + 0x20); // A-Z → a-z
    } else {
      out += ch;
    }
  }
  return out;
}

/** 文字列を CJK/英数字セグメントに分割（正規化済みを想定）。スニペット用途にも使う。 */
export function segments(normalized: string): string[] {
  const segs: string[] = [];
  let m: RegExpExecArray | null;
  SEGMENT_RE.lastIndex = 0;
  while ((m = SEGMENT_RE.exec(normalized)) !== null) segs.push(m[0]);
  return segs;
}

/**
 * MiniSearch 用トークナイザ。CJKはbigram、英数字は単語単位。
 * MiniSearch は index/query 双方でこれを呼ぶ。
 */
export function tokenize(text: string): string[] {
  const normalized = normalize(text);
  const tokens: string[] = [];
  for (const seg of segments(normalized)) {
    if (ALNUM_HEAD.test(seg)) {
      tokens.push(seg); // 型番などはそのまま（prefix検索でヒット）
    } else if (seg.length === 1) {
      tokens.push(seg);
    } else {
      for (let i = 0; i < seg.length - 1; i++) tokens.push(seg.slice(i, i + 2)); // bigram
    }
  }
  return tokens;
}

/**
 * スニペット/ビューアのハイライト用: クエリから「連続セグメント」を取り出す（bigram化しない生の語）。
 * 長い順にして、より長い一致を優先アンカーにできるようにする。
 */
export function querySegments(query: string): string[] {
  const uniq = Array.from(new Set(segments(normalize(query)).filter((s) => s.length >= 1)));
  return uniq.sort((a, b) => b.length - a.length);
}
