async function main() {
  const res = await fetch('http://localhost:9222/json');
  const tabs = await res.json();
  const notebookTab = tabs.find(tab => tab.url.includes('notebooklm.google.com') || tab.title.toLowerCase().includes('notebooklm'));
  if (!notebookTab) {
    console.error("Error: Could not find NotebookLM tab.");
    process.exit(1);
  }
  
  const ws = new WebSocket(notebookTab.webSocketDebuggerUrl);
  let msgId = 1;
  const pendingRequests = new Map();
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (pendingRequests.has(data.id)) {
        const { resolve, reject } = pendingRequests.get(data.id);
        pendingRequests.delete(data.id);
        if (data.error) reject(data.error);
        else resolve(data.result);
      }
    } catch (e) {}
  };
  
  function sendCDP(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  
  await new Promise((resolve) => ws.onopen = resolve);
  await sendCDP('Runtime.enable');
  
  const state = await sendCDP('Runtime.evaluate', {
    expression: `
      (() => {
        // Let's find all text areas, divs with contenteditable, or elements with class note, editor, etc.
        const editors = Array.from(document.querySelectorAll('div[contenteditable], [class*="editor"], [class*="viewer"], [class*="note"], [class*="card"]'))
          .map(el => ({
            tag: el.tagName,
            className: el.className,
            text: (el.innerText || '').slice(0, 200)
          }));
          
        // Let's find the main visible header or titles
        const titles = Array.from(document.querySelectorAll('h1, h2, h3, [class*="title"]'))
          .map(el => el.innerText);
          
        // Let's find any iframe on the page
        const iframes = Array.from(document.querySelectorAll('iframe')).map(f => f.src);
        
        return {
          editors,
          titles,
          iframes
        };
      })()
    `,
    returnByValue: true
  });
  
  console.log(JSON.stringify(state.result.value, null, 2));
  ws.close();
}

main().catch(console.error);
