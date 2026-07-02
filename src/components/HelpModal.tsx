// 「ⓘ ヘルプ」— 誰にでも分かる言葉で使い方と注意事項を説明する。
// どうしても専門用語が要る箇所は <Term> で注釈（タップで小さな説明が開く）。
import { useState } from 'react';

/** 専門用語＋タップで開く注釈。点線の下線＋ⓘで「押せる」ことを示す。 */
function Term({ children, note }: { children: React.ReactNode; note: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`term${open ? ' open' : ''}`}>
      <button className="termWord" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {children}
        <span className="termMark" aria-hidden>
          ⓘ
        </span>
      </button>
      {open && <span className="termNote">{note}</span>}
    </span>
  );
}

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer help" onClick={(e) => e.stopPropagation()}>
        <header className="drawerHead">
          <div className="drawerTitle">ⓘ 使い方 と 注意</div>
          <button className="btn primary" onClick={onClose}>
            閉じる
          </button>
        </header>

        <div className="drawerBody helpBody">
          <h3 className="helpH">このアプリは？</h3>
          <p>
            手元のPDFマニュアルを、キーワードで<b>すぐに引く</b>ためのアプリです。データはすべて
            <Term note="インターネットに送らず、この端末の中だけに保存する、という意味です。だから通信が切れていても使えます。">
              この端末の中だけ
            </Term>
            に保存され、外部には一切送信されません。
          </p>

          <h3 className="helpH">1. マニュアルを入れる</h3>
          <p>
            「ライブラリ」→「＋ PDFを取り込む」から、iPadの中のPDFを選びます（まとめて複数選択できます）。
            入れると本文が自動で読み取られ、検索できるようになります。
            <br />
            <span className="note">
              ※ 文字が画像として入っているだけの
              <Term note="紙をスキャンしただけのPDFなど、文字データを持たないPDF。文字として読み取れないので本文検索はできません。ファイル名やタグで探してください。">
                スキャンPDF
              </Term>
              は本文検索の対象外です。
            </span>
          </p>

          <h3 className="helpH">2. 検索する（いちばんの機能）</h3>
          <p>
            画面上の検索ボックスに、言葉や型番を入れるだけ。「どのマニュアルの何ページ目か」が、
            前後の文つきで一覧に出ます。タップするとそのページが開き、探した言葉が
            <b>黄色く光って</b>見つかります。
            <br />
            <span className="note">※ 型番は途中まで（例「RAS-X2」）でも当たります。日本語は短めの言葉が当たりやすいです。</span>
          </p>

          <h3 className="helpH">3. メモ・写真をつける</h3>
          <p>
            一覧の各マニュアルの「⋯」から、メモを書いたり、写真を貼ったりできます（そのマニュアル専用のメモ・写真です）。
            ★を押すと「お気に入り」になり、一覧のいちばん上に大きく出て、すぐ開けます。
          </p>

          <h3 className="helpH">4. 施策（締切つきのやること）</h3>
          <p>
            「施策」タブで、締切のあるタスクを登録できます。締切が近い順に並び、残り日数が出ます。
            締切間近はオレンジ、過ぎたら赤で目立ちます。関連するマニュアルを1つ紐づけて、ワンタップで開けます。
          </p>

          <h3 className="helpH">5. バックアップ（とても大事）</h3>
          <p>
            「バックアップ」タブの「エクスポート」で、全部のデータを
            <Term note="PDF・メモ・写真・施策などを、まとめて1つのファイルにして保存すること。別の端末や、入れ直したあとに元へ戻せます。">
              1つのファイル
            </Term>
            に保存できます。<b>月1回くらい</b>保存しておくと安心です。戻すときは「バックアップを選んで復元」。
          </p>

          <div className="helpBox danger">
            <h3 className="helpH">⚠ 安全に使うための注意</h3>
            <ul className="helpList">
              <li>
                iPadに<b>パスコード（ロック）</b>を必ず設定してください。端末のロックが、中のデータを守る最後の砦です。
              </li>
              <li>
                バックアップのファイルは、
                <Term note="iCloudやメール、共有パソコンに置くと、そこ経由で中身が外に出てしまう恐れがあります。この端末の中（や手元のUSB等）だけに保管しましょう。">
                  iCloudやメールに置かない
                </Term>
                でください。可能なら
                <Term note="バックアップ作成時に「パスワードで暗号化する」を選ぶと、パスワードなしでは中身を読めないファイルになります。パスワードは忘れると復元できないので大切に。">
                  パスワードで暗号化
                </Term>
                して保存すると安全です。
              </li>
              <li>
                会社・組織の資料を扱う場合は、<b>私物端末に入れてよいか</b>のルールをご自身で確認してください（このアプリは通信では漏らしませんが、持ち出しの可否はルール次第です）。
              </li>
            </ul>
          </div>

          <div className="helpBox">
            <h3 className="helpH">通信について</h3>
            <p>
              このアプリは動作中に<b>インターネット通信を一切しません</b>。マニュアルはこの端末の中だけにあり、
              外へ送られることはありません。
              <br />
              <span className="note">
                ※「
                <Term note="ホーム画面に追加して、通信が無くても使えるようにする仕組み。最初の1回だけオンラインで開いてください（必要な部品を端末に取り込みます）。">
                  ホーム画面に追加
                </Term>
                」して使うと、機内モードでも動きます。暗号化やオフライン化は、
                <Term note="URLが https で始まる接続、または localhost のこと。iPadで完全オフライン＆暗号化を使うには、安全な接続で配信されている必要があります。詳しくは配布担当（README）を参照。">
                  安全な接続
                </Term>
                で開いた場合に有効です。
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
