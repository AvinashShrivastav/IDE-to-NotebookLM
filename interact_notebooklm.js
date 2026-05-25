const fs = require('fs');
const path = require('path');

// Extract action from command-line flag --action=xxx (default is 'ask')
const actionArg = process.argv.find(arg => arg.startsWith('--action='));
const ACTION = actionArg ? actionArg.split('=')[1] : 'ask';

// Configuration & Output paths
const QUESTION_FILE = path.join(__dirname, 'question.txt');
const NOTEBOOK_NAME_FILE = path.join(__dirname, 'notebook_name.txt');
const SOURCE_CONTENT_FILE = path.join(__dirname, 'source_content.txt');
const SOURCE_URL_FILE = path.join(__dirname, 'source_url.txt');

const STUDIO_TARGET_FILE = path.join(__dirname, 'studio_target.txt');
const STUDIO_FETCH_TARGET_FILE = path.join(__dirname, 'studio_fetch_target.txt');

const NOTEBOOKS_LIST_FILE = path.join(__dirname, 'notebooks_list.txt');
const SOURCES_LIST_FILE = path.join(__dirname, 'sources_list.txt');
const STUDY_GUIDE_FILE = path.join(__dirname, 'study_guide_response.txt');
const STUDIO_ASSETS_LIST_FILE = path.join(__dirname, 'studio_assets_list.txt');

async function main() {
  console.log(`=========================================`);
  console.log(`NotebookLM Automation Studio`);
  console.log(`Active Action: ${ACTION.toUpperCase()}`);
  console.log(`=========================================\n`);
  
  console.log("Fetching active tabs from Chrome DevTools...");
  const res = await fetch('http://localhost:9222/json');
  const tabs = await res.json();
  
  const notebookTab = tabs.find(tab => tab.url.includes('notebooklm.google.com') || tab.title.toLowerCase().includes('notebooklm'));
  if (!notebookTab) {
    console.error("Error: Could not find any active NotebookLM tab.");
    console.error("Please make sure Chrome is running with remote debugging active on port 9222.");
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
    const res = await sendCDP('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) {
      throw new Error(`JS Exception: ${res.exceptionDetails.exception.description}`);
    }
    return res.result.value;
  }
  
  async function navigate(url) {
    console.log(`Navigating tab to: ${url}`);
    await sendCDP('Page.navigate', { url });
    // Wait for load event
    await new Promise(resolve => {
      const listener = (event) => {
        const data = JSON.parse(event.data);
        if (data.method === 'Page.loadEventFired') {
          ws.removeEventListener('message', listener);
          resolve();
        }
      };
      ws.addEventListener('message', listener);
    });
  }
  
  // Helper to click on the "Studio" tab header
  async function selectStudioTab() {
    console.log("Ensuring clean state (closing any open artifact dialogs)...");
    const closeDialog = `
      (() => {
        const closeBtn = Array.from(document.querySelectorAll('.artifact-viewer-container button, button'))
          .find(b => b.innerText.includes('close') || b.getAttribute('aria-label') === 'Close');
        if (closeBtn) {
          closeBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          closeBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          closeBtn.click();
          return "Closed active open dialog.";
        }
        return "No active dialog found to close.";
      })()
    `;
    const closeStatus = await evaluate(closeDialog);
    console.log(`Clean State: ${closeStatus}`);
    await new Promise(r => setTimeout(r, 1200));

    console.log("Selecting 'Studio' tab in NotebookLM...");
    const clickStudio = `
      (() => {
        const studioTab = Array.from(document.querySelectorAll('div, button, a, [role="tab"]'))
          .find(el => (el.innerText || '').trim() === 'Studio');
        if (studioTab) {
          studioTab.click();
          return "Clicked Studio tab header.";
        }
        return "Warning: Studio tab header not found. Make sure you are active inside a specific Notebook.";
      })()
    `;
    const status = await evaluate(clickStudio);
    console.log(`Tab Selection: ${status}`);
    await new Promise(r => setTimeout(r, 1500)); // wait for transitions
  }
  
  await sendCDP('Runtime.enable');
  await sendCDP('Page.enable');
  
  // ==========================================
  // ACTION: LIST NOTEBOOKS
  // ==========================================
  if (ACTION === 'list-notebooks') {
    const currentUrl = await evaluate('window.location.href');
    if (!currentUrl.includes('notebooklm.google.com') || currentUrl.includes('/notebook/')) {
      console.log("Not on dashboard page, navigating to dashboard...");
      await navigate('https://notebooklm.google.com/');
      await new Promise(r => setTimeout(r, 4000)); // wait for load
    }
    
    console.log("Extracting notebooks from dashboard...");
    const notebooks = await evaluate(`
      (() => {
        const links = Array.from(document.querySelectorAll('a[href*="/notebook/"]'));
        const notebooks = [];
        const seen = new Set();
        for (const link of links) {
          const url = link.href || link.getAttribute('href') || '';
          const match = url.match(/\\/notebook\\/([a-zA-Z0-9\\-]+)/);
          if (match) {
            const id = match[1];
            if (!seen.has(id)) {
              seen.add(id);
              const titleEl = link.querySelector('.notebook-title, [class*="title"], [class*="name"]') || link;
              const title = (titleEl.innerText || titleEl.textContent || 'Untitled Notebook').trim();
              notebooks.push({ id, title, url });
            }
          }
        }
        return notebooks;
      })()
    `);
    
    console.log("Notebooks list extracted successfully:", notebooks);
    
    let listContent = "=========================================\n";
    listContent += `NotebookLM Available Notebooks (${new Date().toLocaleString()})\n`;
    listContent += "=========================================\n\n";
    notebooks.forEach((nb, index) => {
      listContent += `${index + 1}. Title: ${nb.title}\n`;
      listContent += `   ID:    ${nb.id}\n`;
      listContent += `   Link:  https://notebooklm.google.com/notebook/${nb.id}\n\n`;
    });
    
    fs.writeFileSync(NOTEBOOKS_LIST_FILE, listContent, 'utf8');
    console.log(`Saved notebooks list to: ${NOTEBOOKS_LIST_FILE}`);
  }
  
  // ==========================================
  // ACTION: CREATE NOTEBOOK
  // ==========================================
  else if (ACTION === 'create-notebook') {
    let name = "My Study Notebook";
    if (fs.existsSync(NOTEBOOK_NAME_FILE)) {
      name = fs.readFileSync(NOTEBOOK_NAME_FILE, 'utf8').trim() || name;
    } else {
      fs.writeFileSync(NOTEBOOK_NAME_FILE, name, 'utf8');
    }
    
    const currentUrl = await evaluate('window.location.href');
    if (!currentUrl.includes('notebooklm.google.com') || currentUrl.includes('/notebook/')) {
      console.log("Not on dashboard page, navigating to dashboard...");
      await navigate('https://notebooklm.google.com/');
      await new Promise(r => setTimeout(r, 4000));
    }
    
    console.log(`Creating new notebook: "${name}"...`);
    const clickNewNotebook = `
      (() => {
        const btn = Array.from(document.querySelectorAll('button, a')).find(el => {
          const text = el.innerText || '';
          return text.toLowerCase().includes('new notebook') || text.toLowerCase().includes('create');
        });
        if (btn) {
          btn.click();
          return "Clicked New Notebook button.";
        }
        return "Error: New Notebook button not found.";
      })()
    `;
    const btnStatus = await evaluate(clickNewNotebook);
    console.log("Action Status:", btnStatus);
    
    console.log("Waiting for redirection to the new notebook...");
    let newNotebookUrl = "";
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      newNotebookUrl = await evaluate('window.location.href');
      if (newNotebookUrl.includes('/notebook/') && !newNotebookUrl.includes('notebooks')) {
        break;
      }
    }
    
    console.log(`Inside notebook page: ${newNotebookUrl}`);
    console.log("Waiting for workspace to load...");
    await new Promise(r => setTimeout(r, 4000));
    
    console.log(`Attempting to rename notebook to "${name}"...`);
    const renameScript = `
      (() => {
        let titleEl = document.querySelector('.notebook-name, [class*="notebook-title"], [class*="notebook-name"]');
        if (!titleEl) {
          titleEl = Array.from(document.querySelectorAll('[contenteditable="true"]')).find(el => {
            const text = el.innerText || '';
            return text.includes('Notebook') || text.includes('Untitled');
          });
        }
        
        if (titleEl) {
          titleEl.focus();
          titleEl.innerText = ${JSON.stringify(name)};
          titleEl.dispatchEvent(new Event('input', { bubbles: true }));
          titleEl.dispatchEvent(new Event('change', { bubbles: true }));
          titleEl.dispatchEvent(new Event('blur', { bubbles: true }));
          return "Successfully updated name element.";
        }
        return "Warning: Could not find title element. You can manually rename it on screen.";
      })()
    `;
    const renameResult = await evaluate(renameScript);
    console.log("Rename Status:", renameResult);
  }
  
  // ==========================================
  // ACTION: LIST SOURCES
  // ==========================================
  else if (ACTION === 'list-sources') {
    const currentUrl = await evaluate('window.location.href');
    if (!currentUrl.includes('/notebook/')) {
      console.error("Error: You must be active inside a specific NotebookLM notebook to list sources.");
      process.exit(1);
    }
    
    console.log("Reading sources inside active notebook...");
    const sources = await evaluate(`
      (() => {
        const cards = Array.from(document.querySelectorAll('.source-title, [class*="source-card"], [class*="source-title"], [class*="source-name"]'))
          .map(el => (el.innerText || el.textContent || '').trim())
          .filter(t => t.length > 0);
          
        return cards;
      })()
    `);
    
    console.log("Found active sources:", sources);
    
    let listContent = "=========================================\n";
    listContent += `NotebookLM Notebook Sources (${new Date().toLocaleString()})\n`;
    listContent += "=========================================\n\n";
    if (sources.length === 0) {
      listContent += "(No sources found inside this notebook)\n";
    } else {
      sources.forEach((source, index) => {
        listContent += `${index + 1}. ${source}\n`;
      });
    }
    
    fs.writeFileSync(SOURCES_LIST_FILE, listContent, 'utf8');
    console.log(`Saved sources list to: ${SOURCES_LIST_FILE}`);
  }
  
  // ==========================================
  // ACTION: UPLOAD SOURCE (TEXT OR URL)
  // ==========================================
  else if (ACTION === 'upload-text' || ACTION === 'upload-url') {
    const currentUrl = await evaluate('window.location.href');
    if (!currentUrl.includes('/notebook/')) {
      console.error("Error: You must be inside a specific NotebookLM notebook to upload sources.");
      process.exit(1);
    }
    
    let sourceContent = "";
    if (ACTION === 'upload-text') {
      if (fs.existsSync(SOURCE_CONTENT_FILE)) {
        sourceContent = fs.readFileSync(SOURCE_CONTENT_FILE, 'utf8').trim();
      } else {
        fs.writeFileSync(SOURCE_CONTENT_FILE, "Paste custom text source here...", 'utf8');
        console.error("Please add content to source_content.txt before uploading.");
        process.exit(1);
      }
    } else {
      if (fs.existsSync(SOURCE_URL_FILE)) {
        sourceContent = fs.readFileSync(SOURCE_URL_FILE, 'utf8').trim();
      } else {
        fs.writeFileSync(SOURCE_URL_FILE, "https://example.com", 'utf8');
        console.error("Please add a URL to source_url.txt before uploading.");
        process.exit(1);
      }
    }
    
    console.log("Triggering 'Add Source' Modal...");
    const clickAddSource = `
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => {
          const label = b.getAttribute('aria-label') || '';
          const text = b.innerText || '';
          return label.toLowerCase().includes('add source') || text.toLowerCase().includes('add source') || text.toLowerCase().includes('source');
        });
        if (btn) {
          btn.click();
          return "Clicked Add Source";
        }
        return "Error: Add Source button not found.";
      })()
    `;
    const addSourceStatus = await evaluate(clickAddSource);
    console.log("Add Source button status:", addSourceStatus);
    await new Promise(r => setTimeout(r, 2000));
    
    if (ACTION === 'upload-text') {
      console.log("Selecting 'Copied Text' option...");
      const clickCopiedText = `
        (() => {
          const option = Array.from(document.querySelectorAll('div, button, li')).find(el => {
            const text = el.innerText || '';
            return text.toLowerCase().includes('copied text') || text.toLowerCase().includes('clipboard');
          });
          if (option) {
            option.click();
            return "Clicked Copied Text Option";
          }
          return "Error: Copied Text Option not found";
        })()
      `;
      const clickStatus = await evaluate(clickCopiedText);
      console.log("Option status:", clickStatus);
      await new Promise(r => setTimeout(r, 2000));
      
      console.log("Inputting text and title...");
      const fillTextSource = `
        (() => {
          const inputs = Array.from(document.querySelectorAll('input, textarea'));
          const titleInput = inputs.find(i => i.placeholder && i.placeholder.toLowerCase().includes('title'));
          const bodyTextarea = inputs.find(i => i.tagName === 'TEXTAREA');
          
          if (titleInput) {
            titleInput.value = "Source - " + new Date().toLocaleDateString();
            titleInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (bodyTextarea) {
            bodyTextarea.value = ${JSON.stringify(sourceContent)};
            bodyTextarea.dispatchEvent(new Event('input', { bubbles: true }));
            bodyTextarea.dispatchEvent(new Event('change', { bubbles: true }));
          }
          
          const insertBtn = Array.from(document.querySelectorAll('button')).find(b => {
            const text = b.innerText || '';
            return text.toLowerCase().includes('insert') || text.toLowerCase().includes('save') || text.toLowerCase().includes('add');
          });
          
          if (insertBtn) {
            insertBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            insertBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            insertBtn.click();
            return "Successfully saved text source.";
          }
          return "Error: Insert button not found";
        })()
      `;
      const saveStatus = await evaluate(fillTextSource);
      console.log("Upload Status:", saveStatus);
    } 
    else {
      console.log("Selecting 'Website/URL' option...");
      const clickWebsiteOption = `
        (() => {
          const option = Array.from(document.querySelectorAll('div, button, li')).find(el => {
            const text = el.innerText || '';
            return text.toLowerCase().includes('website') || text.toLowerCase().includes('link') || text.toLowerCase().includes('url');
          });
          if (option) {
            option.click();
            return "Clicked Website Link option";
          }
          return "Error: Website Link option not found";
        })()
      `;
      const clickStatus = await evaluate(clickWebsiteOption);
      console.log("Option status:", clickStatus);
      await new Promise(r => setTimeout(r, 2000));
      
      console.log(`Filling URL: ${sourceContent}...`);
      const fillUrlSource = `
        (() => {
          const input = document.querySelector('input[type="url"], input[placeholder*="http"], input');
          if (!input) return "Error: URL input field not found.";
          
          input.value = ${JSON.stringify(sourceContent)};
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          
          const insertBtn = Array.from(document.querySelectorAll('button')).find(b => {
            const text = b.innerText || '';
            return text.toLowerCase().includes('insert') || text.toLowerCase().includes('save') || text.toLowerCase().includes('add');
          });
          
          if (insertBtn) {
            insertBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            insertBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            insertBtn.click();
            return "Successfully submitted website URL.";
          }
          return "Error: Insert button not found";
        })()
      `;
      const saveStatus = await evaluate(fillUrlSource);
      console.log("Upload Status:", saveStatus);
    }
  }
  
  // ==========================================
  // ACTION: STUDIO LIST (FETCH ALL ASSETS)
  // ==========================================
  else if (ACTION === 'studio-list') {
    const currentUrl = await evaluate('window.location.href');
    if (!currentUrl.includes('/notebook/')) {
      console.error("Error: You must be inside a specific NotebookLM notebook to list Studio assets.");
      process.exit(1);
    }
    
    await selectStudioTab();
    
    console.log("Extracting Studio generated assets history...");
    const assets = await evaluate(`
      (() => {
        // Look for bottom history lists containing 'artifact-item-button' or matching icons and texts
        const items = Array.from(document.querySelectorAll('.artifact-item-button, [class*="asset"], [class*="history-item"], [class*="list-item"]'))
          .filter(el => {
            const text = el.innerText || '';
            return text.includes('source') || text.includes('ago') || text.includes('min') || text.includes('hour');
          })
          .map((el, idx) => {
            // Find icons/labels inside the item to identify asset types
            const text = el.innerText.trim();
            const lines = text.split('\\n');
            const title = lines[1] || lines[0] || 'Unknown Generated File';
            const meta = lines[2] || lines[1] || 'Unknown details';
            const iconEl = el.querySelector('mat-icon, [class*="icon"]');
            const type = iconEl ? (iconEl.innerText || iconEl.textContent || 'Doc').trim() : 'Doc';
            
            return {
              index: idx + 1,
              title: title.trim(),
              type: type.trim(),
              meta: meta.trim()
            };
          });
          
        return items;
      })()
    `);
    
    console.log("Generated Studio assets successfully retrieved:", assets);
    
    let listContent = "=========================================\n";
    listContent += `NotebookLM Studio Generated Assets (${new Date().toLocaleString()})\n`;
    listContent += "=========================================\n\n";
    if (assets.length === 0) {
      listContent += "(No generated files or assets found in Studio tab history)\n";
    } else {
      assets.forEach((ast) => {
        listContent += `[Asset #${ast.index}]\n`;
        listContent += `Title: ${ast.title}\n`;
        listContent += `Type:  ${ast.type}\n`;
        listContent += `Meta:  ${ast.meta}\n`;
        listContent += `-----------------------------------------\n\n`;
      });
    }
    
    fs.writeFileSync(STUDIO_ASSETS_LIST_FILE, listContent, 'utf8');
    console.log(`Saved generated Studio assets to: ${STUDY_GUIDE_FILE}`);
  }
  
  // ==========================================
  // ACTION: STUDIO CREATE (WITH ADAPTIVE POLLING)
  // ==========================================
  else if (ACTION === 'studio-create') {
    const currentUrl = await evaluate('window.location.href');
    if (!currentUrl.includes('/notebook/')) {
      console.error("Error: You must be inside a specific NotebookLM notebook to generate Studio assets.");
      process.exit(1);
    }
    
    let target = "Quiz";
    if (fs.existsSync(STUDIO_TARGET_FILE)) {
      target = fs.readFileSync(STUDIO_TARGET_FILE, 'utf8').trim() || target;
    } else {
      fs.writeFileSync(STUDIO_TARGET_FILE, target, 'utf8');
    }
    
    console.log(`Target Studio Asset to Generate: "${target}"`);
    
    await selectStudioTab();
    
    console.log(`Locating card for "${target}" in Studio...`);
    const clickCardScript = `
      (() => {
        // Find the specific card title span
        const span = Array.from(document.querySelectorAll('span.create-label-container'))
          .find(el => {
            const text = (el.innerText || '').trim();
            return text.toLowerCase() === ${JSON.stringify(target.toLowerCase())};
          });
          
        if (span) {
          const container = span.closest('.create-artifact-button-container');
          if (container) {
            container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            container.click();
            return "Successfully clicked card for " + ${JSON.stringify(target)};
          }
        }
        return "Error: Card for " + ${JSON.stringify(target)} + " not found.";
      })()
    `;
    
    const clickStatus = await evaluate(clickCardScript);
    console.log(`Generator Click Status: ${clickStatus}`);
    
    if (clickStatus.startsWith('Error')) {
      process.exit(1);
    }
    
    console.log("\n=========================================");
    console.log("Generation started! Starting Adaptive Polling...");
    console.log("This safeguards against trigger rate limits & bot protection.");
    console.log("=========================================\n");
    
    // Adaptive Polling Strategy:
    // Audio Overview can take up to 15 minutes. Custom Quizzes / Slide Decks take 10-60s.
    // - Phase 1: First 30s -> Poll every 5s
    // - Phase 2: 30s to 3m -> Poll every 15s
    // - Phase 3: 3m to 8m -> Poll every 30s
    // - Phase 4: 8m to 20m -> Poll every 60s
    
    const maxTimeMs = 20 * 60 * 1000; // 20 minutes timeout
    let elapsedMs = 0;
    let pollIntervalMs = 5000; // start at 5s
    let previousText = "";
    let stableCount = 0;
    let finalDocContent = "";
    
    while (elapsedMs < maxTimeMs) {
      // Set the dynamic interval
      if (elapsedMs < 30 * 1000) {
        pollIntervalMs = 5000;
      } else if (elapsedMs < 3 * 60 * 1000) {
        pollIntervalMs = 15000;
      } else if (elapsedMs < 8 * 60 * 1000) {
        pollIntervalMs = 30000;
      } else {
        pollIntervalMs = 60000;
      }
      
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      elapsedMs += pollIntervalMs;
      
      // Check if open document/artifact view is loaded
      const checkDocScript = `
        (() => {
          // Look for active open document panel or markdown viewer
          const viewer = document.querySelector('.formatted-text, [role="document"], .document-viewer, [class*="viewer"]');
          const spinner = document.querySelector('[class*="spinner"], [class*="loading"], [class*="indicator"], [class*="progress"]');
          
          // Audio Overview generates a player instead of plain formatted text
          const audioPlayer = document.querySelector('.audio-player-container, [class*="audio-player"]');
          
          if (audioPlayer) {
            // Find if download button is available
            const downloadBtn = document.querySelector('button[aria-label*="Download"], button[aria-label*="download"]');
            return {
              type: 'audio',
              loaded: !!downloadBtn,
              text: "Audio Overview Media Player Loaded successfully."
            };
          }
          
          return {
            type: 'document',
            loaded: !!viewer && !spinner,
            text: viewer ? (viewer.innerText || viewer.textContent || '').trim() : ""
          };
        })()
      `;
      
      const state = await evaluate(checkDocScript);
      const textLen = state.text ? state.text.length : 0;
      
      console.log(`[Time: ${Math.round(elapsedMs / 1000)}s] Poll: Type=${state.type}, Loaded=${state.loaded}, Content Length=${textLen}`);
      
      if (state.loaded) {
        if (state.type === 'audio') {
          console.log("Audio Overview generation completed successfully! Downloading Audio File...");
          const triggerDownload = `
            (() => {
              const downloadBtn = document.querySelector('button[aria-label*="Download"], button[aria-label*="download"]');
              if (downloadBtn) {
                downloadBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                downloadBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                downloadBtn.click();
                return "Clicked download button successfully.";
              }
              return "Error: Download button disappeared.";
            })()
          `;
          const downloadStatus = await evaluate(triggerDownload);
          console.log(`Download Trigger: ${downloadStatus}`);
          finalDocContent = "Audio Overview Generated and Download triggered successfully inside Chrome.";
          break;
        } else if (textLen > 100) {
          if (state.text === previousText) {
            stableCount++;
            if (stableCount >= 2) {
              finalDocContent = state.text;
              break;
            }
          } else {
            stableCount = 0;
            previousText = state.text;
          }
        }
      }
    }
    
    if (!finalDocContent) {
      console.log("Timeout or empty output. Fetching body fallback...");
      finalDocContent = await evaluate('document.body.innerText');
    }
    
    const fileSlug = target.toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/(^_+|_+$)/g, '') || 'studio_item';
      
    const studioOutPath = path.join(__dirname, `response_studio_${fileSlug}.txt`);
    fs.writeFileSync(studioOutPath, finalDocContent, 'utf8');
    console.log(`\nSuccess! Studio response saved to: response_studio_${fileSlug}.txt`);
  }
  
  // ==========================================
  // ACTION: STUDIO FETCH ITEM
  // ==========================================
  else if (ACTION === 'studio-fetch-item') {
    const currentUrl = await evaluate('window.location.href');
    if (!currentUrl.includes('/notebook/')) {
      console.error("Error: You must be inside a specific NotebookLM notebook to fetch Studio assets.");
      process.exit(1);
    }
    
    let target = "1";
    if (fs.existsSync(STUDIO_FETCH_TARGET_FILE)) {
      target = fs.readFileSync(STUDIO_FETCH_TARGET_FILE, 'utf8').trim() || target;
    } else {
      fs.writeFileSync(STUDIO_FETCH_TARGET_FILE, target, 'utf8');
    }
    
    console.log(`Target Studio Asset to open/fetch: "${target}"`);
    
    await selectStudioTab();
    
    console.log("Locating asset card and opening it...");
    const openItemScript = `
      (() => {
        const items = Array.from(document.querySelectorAll('.artifact-item-button, [class*="asset"], [class*="history-item"], [class*="list-item"]'))
          .filter(el => {
            const text = el.innerText || '';
            return text.includes('source') || text.includes('ago') || text.includes('min') || text.includes('hour');
          });
          
        let targetEl = null;
        const targetStr = ${JSON.stringify(target)};
        
        // If target is a number, treat as index (1-based)
        if (/^\\d+$/.test(targetStr)) {
          const idx = parseInt(targetStr) - 1;
          targetEl = items[idx];
        } else {
          // Otherwise search by matching text title
          targetEl = items.find(el => {
            const lines = el.innerText.split('\\n');
            const title = lines[1] || lines[0] || '';
            return title.toLowerCase().includes(targetStr.toLowerCase());
          });
        }
        
        if (targetEl) {
          // Select the clickable button inside the asset item card to trigger navigation
          const btn = targetEl.querySelector('button') || targetEl;
          btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          btn.click();
          return { success: true, title: targetEl.innerText.split('\\n')[1] || targetEl.innerText.split('\\n')[0] };
        }
        return { success: false, error: "Asset not found in bottom list." };
      })()
    `;
    
    const clickStatus = await evaluate(openItemScript);
    console.log("Open Status:", clickStatus);
    
    if (!clickStatus.success) {
      process.exit(1);
    }
    
    console.log("Waiting for document panel to load and open...");
    await new Promise(r => setTimeout(r, 4500)); // slightly longer wait for rich document layouts
    
    console.log("Triggering original asset file download via Chrome...");
    const downloadStatus = await evaluate(`
      (async () => {
        const audioPlayer = document.querySelector('.audio-player-container, [class*="audio-player"]');
        if (audioPlayer) {
          const downloadBtn = document.querySelector('button[aria-label*="Download"], button[aria-label*="download"]');
          if (downloadBtn) {
            downloadBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            downloadBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            downloadBtn.click();
            return { downloaded: true, msg: "Audio download triggered successfully." };
          }
          return { downloaded: false, error: "Audio player open but download button not found." };
        }
        
        // Find three-dot menu button in the opened artifact container
        const menuBtn = Array.from(document.querySelectorAll('.artifact-viewer-container button'))
          .find(b => b.innerText.includes('more') || b.innerText.includes('horiz') || b.getAttribute('aria-label') === 'More options');
          
        if (menuBtn) {
          menuBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          menuBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          menuBtn.click();
          
          // Wait 1.2s for the popover menu to render
          await new Promise(resolve => setTimeout(resolve, 1200));
          
          // Find the download menu item
          const dlBtn = Array.from(document.querySelectorAll('.mat-mdc-menu-panel button, [role="menuitem"]'))
            .find(b => b.innerText.includes('Download') || b.innerText.includes('save_alt'));
            
          if (dlBtn) {
            dlBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            dlBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            dlBtn.click();
            return { downloaded: true, msg: "Clicked Download menu option. File download triggered successfully." };
          }
          return { downloaded: false, error: "Menu opened, but Download item not found." };
        }
        return { downloaded: false, error: "Three-dot options menu not found." };
      })()
    `);
    
    console.log("Download Status:", downloadStatus);
    
    console.log("Extracting opened document text content...");
    const extractContent = `
      (() => {
        // Multi-selector covering standard text documents, custom notes, quizzes, reports, and mind-maps
        const viewer = document.querySelector('.formatted-text, [role="document"], .document-viewer, [class*="viewer"], [class*="note"], [class*="active-document"], [class*="opened-document"]');
        return viewer ? (viewer.innerText || viewer.textContent || '').trim() : document.body.innerText;
      })()
    `;
    
    const docContent = await evaluate(extractContent);
    
    // Check if the extracted text only contains UI labels, which indicates it's a visual/image asset
    const isUILabelOnly = docContent.includes('Download') && docContent.includes('Delete') && docContent.includes('Good content') && docContent.length < 500;
    
    let fileContent = docContent;
    if (isUILabelOnly && downloadStatus.downloaded) {
      fileContent = `=========================================================================\n`;
      fileContent += `NotebookLM Studio Asset: ${clickStatus.title}\n`;
      fileContent += `=========================================================================\n\n`;
      fileContent += `[File Download Completed]\n`;
      fileContent += `This is a visual/image asset (such as an Infographic, Slide Deck, or Mind Map).\n\n`;
      fileContent += `Because it is a visual file, the high-resolution copy was successfully\n`;
      fileContent += `downloaded directly to your local computer's "Downloads" folder via Chrome.\n\n`;
      fileContent += `Please check your system's "Downloads" folder to view the complete file!\n`;
    }
    
    const fileSlug = clickStatus.title.toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/(^_+|_+$)/g, '') || 'studio_item';
      
    const outPath = path.join(__dirname, `response_studio_${fileSlug}.txt`);
    fs.writeFileSync(outPath, fileContent, 'utf8');
    console.log(`Success! Text content retrieved and saved to: response_studio_${fileSlug}.txt`);
  }
  
  // ==========================================
  // ACTION: GENERATE STUDY GUIDE (LEGACY)
  // ==========================================
  else if (ACTION === 'generate-study-guide') {
    const currentUrl = await evaluate('window.location.href');
    if (!currentUrl.includes('/notebook/')) {
      console.error("Error: You must be inside a specific NotebookLM notebook to generate a Study Guide.");
      process.exit(1);
    }
    
    console.log("Opening Notebook Guide / Studio Panel...");
    const clickGuide = `
      (() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => {
          const text = b.innerText || '';
          return text.toLowerCase().includes('guide') || text.toLowerCase().includes('notebook guide');
        });
        if (btn) {
          btn.click();
          return "Opened Notebook Guide";
        }
        return "Error: Notebook Guide button not found.";
      })()
    `;
    const guideStatus = await evaluate(clickGuide);
    console.log("Guide Status:", guideStatus);
    await new Promise(r => setTimeout(r, 2000));
    
    console.log("Selecting 'Study Guide' option...");
    const clickStudyGuide = `
      (() => {
        const option = Array.from(document.querySelectorAll('div, button, li')).find(el => {
          const text = el.innerText || '';
          return text.toLowerCase().includes('study guide');
        });
        if (option) {
          option.click();
          return "Successfully clicked Study Guide generator.";
        }
        return "Error: Study Guide generator option not found.";
      })()
    `;
    const studyGuideStatus = await evaluate(clickStudyGuide);
    console.log("Study Guide Status:", studyGuideStatus);
    
    console.log("Waiting for Study Guide to generate (polling output card)...");
    let studyGuideText = "";
    let previousText = "";
    let stableCount = 0;
    
    for (let i = 0; i < 45; i++) {
      await new Promise(r => setTimeout(r, 2000));
      
      const checkStudyGuideText = `
        (() => {
          const cards = Array.from(document.querySelectorAll('[class*="card"], [class*="document"], .response-text'))
            .filter(el => {
              const text = el.innerText || '';
              return text.toLowerCase().includes('study guide') || text.toLowerCase().includes('quiz') || text.toLowerCase().includes('essay');
            });
            
          if (cards.length > 0) {
            return cards[cards.length - 1].innerText;
          }
          
          const messages = Array.from(document.querySelectorAll('.response-text, [class*="message"]'));
          if (messages.length > 0) {
            return messages[messages.length - 1].innerText;
          }
          return "";
        })()
      `;
      
      const text = await evaluate(checkStudyGuideText);
      const textLen = text ? text.length : 0;
      console.log(`Iteration ${i+1}: Study Guide Length = ${textLen}`);
      
      if (textLen > 100) {
        if (text === previousText) {
          stableCount++;
          if (stableCount >= 4) {
            studyGuideText = text;
            break;
          }
        } else {
          stableCount = 0;
          previousText = text;
        }
      }
    }
    
    if (!studyGuideText) {
      console.log("Guide polling finished or timed out. Extracting body text fallback...");
      studyGuideText = await evaluate('document.body.innerText');
    }
    
    fs.writeFileSync(STUDY_GUIDE_FILE, studyGuideText, 'utf8');
    console.log(`Successfully saved generated Study Guide to: ${STUDY_GUIDE_FILE}`);
  }
  
  // ==========================================
  // ACTION: ASK (DEFAULT CHAT QUERY)
  // ==========================================
  else {
    let QUESTION = "what is drive hub?";
    try {
      if (fs.existsSync(QUESTION_FILE)) {
        QUESTION = fs.readFileSync(QUESTION_FILE, 'utf8').trim() || QUESTION;
      } else {
        fs.writeFileSync(QUESTION_FILE, QUESTION, 'utf8');
      }
    } catch (e) {
      console.log("Could not read question.txt, using default.");
    }
    
    const fileSlug = QUESTION.toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/(^_+|_+$)/g, '') || 'response';
      
    const CHAT_OUTPUT_FILE = path.join(__dirname, `response_${fileSlug}.txt`);
    
    console.log(`Question: "${QUESTION}"`);
    console.log(`Output:    response_${fileSlug}.txt\n`);
    
    const currentUrl = await evaluate('window.location.href');
    if (!currentUrl.includes('/notebook/')) {
      console.error("Error: You must be inside a specific NotebookLM notebook to ask questions in chat.");
      process.exit(1);
    }
    
    console.log("Cleaning up first search input and targeting correct chat input...");
    const typeAndSendScript = `
      (() => {
        const searchInput = document.querySelector('textarea[placeholder*="Search"]');
        if (searchInput) {
          searchInput.value = "";
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
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
          sendButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          sendButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          sendButton.click();
          
          const form = input.closest('form');
          if (form) {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
          return "Clicked the send button successfully and dispatched form submit.";
        } else {
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
    
    for (let i = 0; i < 45; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const checkState = `
        (() => {
          const chatContainers = Array.from(document.querySelectorAll('.response-text, [class*="response"], [class*="chat-bubble"], [class*="bubble"], [class*="message-content"]'))
            .map(el => el.innerText || el.textContent)
            .filter(t => t && t.trim().length > 10);
            
          let text = "";
          if (chatContainers.length > 0) {
            text = chatContainers[chatContainers.length - 1];
          } else {
            const paragraphs = Array.from(document.querySelectorAll('p, li, blockquote, pre'))
              .map(el => el.innerText || el.textContent)
              .filter(t => t && t.trim().length > 10);
            if (paragraphs.length > 0) {
              text = paragraphs.slice(-5).join('\\n');
            }
          }
          
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
    
    console.log(`Writing result to ${CHAT_OUTPUT_FILE}...`);
    fs.writeFileSync(CHAT_OUTPUT_FILE, responseText, 'utf8');
    console.log("Success! File saved successfully.");
  }
  
  ws.close();
}

main().catch(console.error);
