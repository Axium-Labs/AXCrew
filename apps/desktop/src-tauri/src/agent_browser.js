// Fixed operations only. Remote documents get no Tauri/host IPC capability.
(async (input, permitted, callback) => {
  const titleKey = Symbol.for('axcrew.browser.pageTitle');
  const pageTitle = document.title.startsWith('ax-browser-result:') ? (globalThis[titleKey] ?? '') : document.title;
  globalThis[titleKey] = pageTitle;
  const send = value => {
    const original = pageTitle, result = callback + encodeURIComponent(JSON.stringify(value));
    document.title = result;
    setTimeout(() => { if (document.title === result) document.title = original; }, 100);
  };
  try {
    if (location.origin !== permitted) { if (['open', 'goto'].includes(input.action)) return; throw Error('Browser origin changed; request access again'); }
    if (!document.body || document.readyState === 'loading') return;
    const target = input.target ? document.querySelector(input.target) : document.activeElement;
    const permitNavigation = href => {
      const next = new URL(href, location.href);
      if (!['http:', 'https:'].includes(next.protocol) || next.username || next.password || next.origin !== permitted) {
        send({ status: 'navigation_blocked', url: location.href, blocked_url: next.href.slice(0, 8192), reason: 'Call goto with this URL to request authorization for its origin' });
        return false;
      }
      return true;
    };
    let navigating = false;
    switch (input.action) {
      case 'click':
        if (!(target instanceof HTMLElement)) throw Error('CSS target not found');
        if (target.closest('a[href]') && !permitNavigation(target.closest('a[href]').href)) return;
        if ((target instanceof HTMLButtonElement || target instanceof HTMLInputElement) && target.form && target.type === 'submit' && !permitNavigation(target.getAttribute('formaction') || target.form.action)) return;
        navigating = !!target.closest('a[href]') || !!(target.form && target.type === 'submit');
        target.scrollIntoView({ block: 'center' }); target.click(); break;
      case 'fill': case 'type': {
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) throw Error('Editable input target not found');
        target.focus();
        const setter = Object.getOwnPropertyDescriptor(target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
        const text = input.text ?? '', start = target.selectionStart, end = target.selectionEnd;
        setter.call(target, input.action === 'type' ? (start === null || end === null ? target.value + text : target.value.slice(0, start) + text + target.value.slice(end)) : text);
        if (input.action === 'type' && start !== null) target.setSelectionRange(start + text.length, start + text.length);
        target.dispatchEvent(new Event('input', { bubbles: true })); target.dispatchEvent(new Event('change', { bubbles: true })); break;
      }
      case 'press': {
        if (!(target instanceof HTMLElement)) throw Error('Keyboard target not found');
        const keys = ['Enter', 'Tab'];
        if (!keys.includes(input.key)) throw Error('Embedded browser supports Enter and Tab; other keys require desktop keyboard control');
        const accepted = target.dispatchEvent(new KeyboardEvent('keydown', { key: input.key, bubbles: true, cancelable: true }));
        if (!accepted) break;
        if (input.key === 'Enter') { if (target instanceof HTMLInputElement && target.form) { if (!permitNavigation(target.form.action)) return; navigating = true; target.form.requestSubmit(); } else if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) { if (target instanceof HTMLAnchorElement && !permitNavigation(target.href)) return; navigating = target instanceof HTMLAnchorElement; target.click(); } }
        if (input.key === 'Tab') { const nodes = [...document.querySelectorAll('a[href],button,input,textarea,select,[tabindex]')].filter(el => !el.disabled && el.getClientRects().length); nodes[(nodes.indexOf(target) + 1) % nodes.length]?.focus(); }
        target.dispatchEvent(new KeyboardEvent('keyup', { key: input.key, bubbles: true })); break;
      }
    }
    if (!navigating && ['click', 'fill', 'type', 'press'].includes(input.action)) await new Promise(resolve => setTimeout(resolve, 100));
    const selector = el => {
      if (el.id) return '#' + CSS.escape(el.id);
      const parts = [];
      for (let node = el; node && node !== document.body && parts.length < 12; node = node.parentElement) {
        const peers = [...node.parentElement.children].filter(other => other.tagName === node.tagName);
        parts.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + (peers.indexOf(node) + 1) + ')');
      }
      return 'body > ' + parts.join(' > ');
    };
    const result = { status: 'completed', transport: 'axcrew_builtin', url: location.href.slice(0, 8192), title: pageTitle.slice(0, 2000) };
    if (navigating) result.navigation_expected = true;
    if (document.querySelector('input[type=password]')) result.snapshot_skipped = 'password_field';
    else {
      result.snapshot = document.body.innerText.slice(0, 24000);
      result.targets = [...document.querySelectorAll('a[href],button,input,textarea,select,[role=button]')].filter(el => el.getClientRects().length).slice(0, 100).map(el => ({ selector: selector(el), role: el.getAttribute('role') || el.tagName.toLowerCase(), text: (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || '').slice(0, 300), ...(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? { value: el.value.slice(0, 300) } : {}) }));
    }
    send(result);
  } catch (error) { send({ error: String(error.message ?? error).slice(0, 2000) }); }
})
