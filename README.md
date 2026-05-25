# NotebookLM Query Automator

This utility automates interactions with your active **NotebookLM** browser session using the **Chrome DevTools Protocol (CDP)**. It allows you to submit questions to the open chat window and save the generated answers as structured text files.

---

## Prerequisites

### 1. Node.js
Ensure Node.js (version **20.x or higher**) is installed. To verify your version, run:
```bash
node --version
```
*(Node 20+ is required because the script leverages the built-in experimental native WebSocket client to avoid heavy `node_modules` dependencies.)*

### 2. Chrome in Debugging Mode
Chrome must be launched with the remote debugging port enabled. 

1. Close all active Chrome windows completely.
2. Open your terminal and start Chrome with port `9222` enabled:
   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
   ```
3. In this Chrome instance, open your NotebookLM workspace:
   `https://notebooklm.google.com/`

### 3. Verify CDP Status (Optional)
To verify if Chrome's DevTools Protocol is running successfully, open a new terminal tab and run:
```bash
curl http://localhost:9222/json/version
```
If successful, you will see a JSON printout containing the browser details.

---

## How to Use

1. Open **`question.txt`** and replace the existing text with the question you want to ask NotebookLM. Save the file.
2. In your terminal, run the helper script:
   ```bash
   ./ask.sh
   ```
3. The script will automatically:
   - Connect to the active NotebookLM tab.
   - Insert and submit the question in the chat input.
   - Wait for the response to fully generate/stream.
   - Save the answer as a text file named after your question:
     `response_<your_slugified_question>.txt`

---

## File Structure

* `interact_notebooklm.js` — The main automation script containing the CDP WebSocket logic.
* `question.txt` — The text file containing your active question.
* `ask.sh` — The quick shortcut launcher.
* `response_*.txt` — The generated outputs from NotebookLM.
