/**
 * @fileoverview CJK IME input for xterm.js terminal.
 *
 * Always-visible textarea below the terminal (in index.html).
 * The browser handles IME composition natively — we just read
 * textarea.value on Enter and send it to PTY.
 * While this textarea has focus, window.cjkActive = true blocks xterm's onData.
 * Arrow keys and function keys are forwarded to PTY directly.
 *
 * @globals {object} CjkInput
 * @loadorder 5.5 of 9 — loaded after keyboard-accessory.js, before app.js
 */

// eslint-disable-next-line no-unused-vars
const CjkInput = (() => {
  let _textarea = null;
  let _send = null;

  const PASSTHROUGH_KEYS = {
    ArrowUp:    '\x1b[A',
    ArrowDown:  '\x1b[B',
    ArrowLeft:  '\x1b[D',
    ArrowRight: '\x1b[C',
    Home:       '\x1b[H',
    End:        '\x1b[F',
    Tab:        '\t',
  };

  const CTRL_KEYS = {
    c: '\x03', d: '\x04', l: '\x0c', z: '\x1a', a: '\x01', e: '\x05',
  };

  return {
    init({ send }) {
      _send = send;
      _textarea = document.getElementById('cjkInput');
      if (!_textarea) return this;

      _textarea.addEventListener('mousedown', (e) => { e.stopPropagation(); });
      _textarea.addEventListener('focus', () => { window.cjkActive = true; });
      _textarea.addEventListener('blur', () => { window.cjkActive = false; });

      _textarea.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229) return;

        // Enter: send accumulated text (or bare Enter if empty)
        if (e.key === 'Enter') {
          e.preventDefault();
          if (_textarea.value) {
            _send(_textarea.value + '\r');
            _textarea.value = '';
          } else {
            _send('\r');
          }
          return;
        }

        // Escape: clear textarea
        if (e.key === 'Escape') {
          e.preventDefault();
          _textarea.value = '';
          return;
        }

        // Ctrl combos: forward to PTY
        if (e.ctrlKey && CTRL_KEYS[e.key]) {
          e.preventDefault();
          _send(CTRL_KEYS[e.key]);
          return;
        }

        // Backspace: delete from textarea if has text, else forward to PTY
        if (e.key === 'Backspace' && !_textarea.value) {
          e.preventDefault();
          _send('\x7f');
          return;
        }

        // Arrow/function keys: forward to PTY when textarea is empty
        if (PASSTHROUGH_KEYS[e.key] && !_textarea.value) {
          e.preventDefault();
          _send(PASSTHROUGH_KEYS[e.key]);
          return;
        }
      });

      return this;
    },

    get element() { return _textarea; },
  };
})();
