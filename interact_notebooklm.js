const fs = require('fs');
const path = require('path');
// Read the question from question.txt
let QUESTION = "what is drive hub?";
try {
  const questionPath = path.join(__dirname, 'question.txt');
  if (fs.existsSync(questionPath)) {
    QUESTION = fs.readFileSync(questionPath, 'utf8').trim();
  } else {
    fs.writeFileSync(questionPath, QUESTION, 'utf8');
  }
} catch (e) {
  console.log("Could not read question.txt, using default question.");
}

// Create a safe, unique filename slug from the question
const fileSlug = QUESTION.toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/(^_+|_+$)/g, '') || 'response';
  
const OUTPUT_FILE = path.join(__dirname, `response_${fileSlug}.txt`);

console.log(`=========================================`);
console.log(`Reading question from: question.txt`);
console.log(`Question: "${QUESTION}"`);
console.log(`Saving to: response_${fileSlug}.txt`);
console.log(`=========================================\n`);

async function main() {
  console.log("Fetching active tabs from Chrome DevTools...");
  const res = await fetch('http://localhost:9222/json');
  const tabs = await res.json();
  
  const notebookTab = tabs.find(tab => tab.url.includes('notebooklm.google.com') || tab.title.toLowerCase().includes('notebooklm'));
  if (!notebookTab) {
    console.error("Error: Could not find any active NotebookLM tab.");
    process.exit(1);
  }
  
  console.log(`Found NotebookLM tab: "${notebookTab.title}"`);
  console.log(`Connecting to WebSocket: ${notebookTab.webSocketDebuggerUrl}`);
  
  const ws = new WebSocket(notebookTab.webSocketDebuggerUrl);
  
  let msgId = 1;
  const pendingRequests = new Map();
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (pendingRequests.has(data.id)) {
        const { resolve, reject } = pendingRequests.get(data.id);
        pendingRequests.delete(data.id);
        if (data.error) {
          reject(data.error);
        } else {
          resolve(data.result);
        }
      }
    } catch (e) {
      console.error("Error parsing WS message:", e);
    }
  };
  
  function sendCDP(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  console.log("Connected to browser session via CDP WebSocket.");
  
  async function evaluate(expression) {
    const res = await sendCDP('Runtime.evaluate', { expression, returnByValue: true });
    if (res.exceptionDetails) {
      throw new Error(`JS Exception: ${res.exceptionDetails.exception.description}`);
    }
    return res.result.value;
  }
  
  await sendCDP('Runtime.enable');
  
  console.log("Cleaning up first search input and targeting correct chat input...");
  const typeAndSendScript = `
    (() => {
      // Clear the Search textarea if it was filled by the previous attempt
      const searchInput = document.querySelector('textarea[placeholder*="Search"]');
      if (searchInput) {
        searchInput.value = "";
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        searchInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      
      // Target correct textarea (Ask a question or create something)
      let input = document.querySelector('textarea[placeholder*="Ask"], textarea[placeholder*="question"]');
      if (!input) {
        const allTextareas = Array.from(document.querySelectorAll('textarea'));
        input = allTextareas.find(t => t.placeholder && (t.placeholder.includes('Ask') || t.placeholder.includes('question') || t.placeholder.includes('create')));
        if (!input && allTextareas.length > 1) {
          input = allTextareas[1];
        } else if (!input) {
          input = document.querySelector('textarea, [role="textbox"]');
        }
      }
      
      if (!input) return "Error: Target input element not found.";
      
      input.focus();
      if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        input.value = ${JSON.stringify(QUESTION)};
      } else {
        input.innerText = ${JSON.stringify(QUESTION)};
      }
      
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Let's find the send/submit button specifically
      let sendButton = null;
      let parent = input.parentElement;
      for (let i = 0; i < 5; i++) {
        if (!parent) break;
        sendButton = parent.querySelector('button.submit-button, button[aria-label="Submit"], button[aria-label="Send"]');
        if (sendButton) break;
        parent = parent.parentElement;
      }
      
      if (!sendButton) {
        sendButton = document.querySelector('button.submit-button, button[aria-label="Submit"], button[aria-label="Send"]');
      }
      
      if (sendButton) {
        sendButton.focus();
        // Dispatch mousedown, mouseup, and click sequence
        sendButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        sendButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        sendButton.click();
        
        // Also trigger form submit event directly as a fallback
        const form = input.closest('form');
        if (form) {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
        return "Clicked the send button successfully and dispatched form submit.";
      } else {
        // Fallback: Dispatch Enter key
        const downEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        });
        input.dispatchEvent(downEvent);
        return "Send button not found, dispatched Enter keydown.";
      }
    })()
  `;
  
  const submitStatus = await evaluate(typeAndSendScript);
  console.log("Submission Status:", submitStatus);
  
  console.log("Waiting for NotebookLM to generate the response...");
  
  let previousLength = 0;
  let responseText = "";
  let stableCount = 0;
  
  // Poll for 90 seconds (45 iterations of 2 seconds)
  for (let i = 0; i < 45; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const checkState = `
      (() => {
        // Let's locate the model responses.
        // NotebookLM has elements containing class "response-text", or elements inside chat-bubble containers.
        const chatContainers = Array.from(document.querySelectorAll('.response-text, [class*="response"], [class*="chat-bubble"], [class*="bubble"], [class*="message-content"]'))
          .map(el => el.innerText || el.textContent)
          .filter(t => t && t.trim().length > 10);
          
        let text = "";
        if (chatContainers.length > 0) {
          text = chatContainers[chatContainers.length - 1];
        } else {
          // If no specific container is found, let's grab paragraphs
          const paragraphs = Array.from(document.querySelectorAll('p, li, blockquote, pre'))
            .map(el => el.innerText || el.textContent)
            .filter(t => t && t.trim().length > 10);
          if (paragraphs.length > 0) {
            text = paragraphs.slice(-5).join('\\n');
          }
        }
        
        // Detect generating indicator
        const stopButton = document.querySelector('button[aria-label*="Stop"], button[aria-label*="stop"]');
        const spinner = document.querySelector('[class*="spinner"], [class*="loading"], [class*="indicator"], [class*="progress"]');
        
        return {
          text: text || "",
          generating: !!stopButton || !!spinner
        };
      })()
    `;
    
    const state = await evaluate(checkState);
    const textLength = state.text ? state.text.length : 0;
    
    console.log(`Iteration ${i+1}: Text Length = ${textLength}, Generating = ${state.generating}`);
    
    if (textLength > 0) {
      if (textLength === previousLength && !state.generating) {
        stableCount++;
        // If text length is stable and not generating for 3 cycles (6s), we are done!
        if (stableCount >= 3) {
          responseText = state.text;
          break;
        }
      } else {
        stableCount = 0;
        previousLength = textLength;
        responseText = state.text;
      }
    }
  }
  
  if (!responseText || responseText.length < 50) {
    console.log("Polled output was too short. Extracting entire page text as fallback...");
    responseText = await evaluate('document.body.innerText');
  }
  
  console.log(`Writing result to ${OUTPUT_FILE}...`);
  fs.writeFileSync(OUTPUT_FILE, responseText, 'utf8');
  console.log("Success! File saved successfully.");
  
  ws.close();
}

main().catch(console.error);
