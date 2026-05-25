# NotebookLM Automation Studio

This workspace contains a comprehensive, modular suite of automation tools designed to control and extract data from your active **NotebookLM** browser session via the **Chrome DevTools Protocol (CDP)**.

No external, heavy third-party automation packages (like Puppeteer or Selenium) are required. The entire engine is built using Node's standard libraries and native WebSocket protocol, making it exceptionally fast, secure, and light.

---

## Prerequisites

### 1. Node.js
Ensure Node.js (version **20.x or higher**) is installed:
```bash
node --version
```

### 2. Launch Chrome in Debugging Mode
Chrome must be launched with the remote debugging port active so the scripts can safely connect to your authenticated session.

1. Close all active Chrome windows completely.
2. Run this command in your terminal to start Chrome in debug mode:
   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
   ```
3. Open **NotebookLM** (`https://notebooklm.google.com/`) in this debugging Chrome instance.

---

## Workspace Tools & Launcher Shortcuts

Each action has a dedicated shortcut shell script and uses simple text files for inputs and outputs:

### 1. Chat Query
Ask any question to your active notebook chat.
* **Input File**: `question.txt` (edit to write your question)
* **Launcher**: `./ask.sh`
* **Output File**: `response_<your_question_slug>.txt`

### 2. List Your Notebooks
Retrieve all notebooks on your dashboard.
* **Launcher**: `./list_notebooks.sh`
* **Output File**: `notebooks_list.txt`

### 3. Create a New Notebook
Create a new notebook with a custom name.
* **Input File**: `notebook_name.txt` (edit to set the notebook name)
* **Launcher**: `./create_notebook.sh`

### 4. List Active Sources
Retrieve all uploaded source titles in your currently open notebook.
* **Launcher**: `./list_sources.sh`
* **Output File**: `sources_list.txt`

### 5. Upload a Source (Text or URL)
Add a source to your currently open notebook.
* **Input Files**: 
  - `source_content.txt` (edit to add copy-pasted text)
  - `source_url.txt` (edit to set web page links)
* **Launcher**: `./upload_source.sh` (an interactive script prompting you to choose text `[t]` or URL `[u]`)

### 6. Create NotebookLM Studio Assets
Generate any of the 9 study assets in NotebookLM's **Studio** tab.
* **Launcher**: `./studio_create.sh`
* **Options**:
  1. Audio Overview
  2. Slide Deck
  3. Video Overview
  4. Mind Map
  5. Reports
  6. Flashcards
  7. Quiz
  8. Infographic
  9. Data Table
* **Input File**: `studio_target.txt` (automatically updated when running the launcher)
* **Output File**: `response_studio_<type>.txt`
* **Adaptive Polling Safeguard**: Complex generations (like Audio Overview podcasts) can take up to 15 minutes. To avoid triggering Google's rate limits or bot-detection systems, the script implements **Exponential Adaptive Backoff Polling** (e.g. polling every 5s initially, dynamically backing off to 60s intervals). This keeps your session fully safe.

### 7. Fetch Studio History Assets
List and download/retrieve previously generated Studio files.
* **Launcher**: `./studio_fetch.sh`
* **Options**:
  - `[l]` List all generated historical assets to `studio_assets_list.txt`.
  - `[d]` Fetch/download the full content of an asset by index (e.g., `1`) or title.
* **Audio Downloads**: If the target is an **Audio Overview**, the script automatically triggers Chrome to download the generated `.mp3` audio file! Otherwise, it extracts the complete rich text of the document to `response_studio_<slugified_title>.txt`.

---

## File Structure

```text
├── README.md                      # This guide
├── interact_notebooklm.js         # Unified automation engine
├── ask.sh                         # Chat launcher
├── list_notebooks.sh              # Dashboard list launcher
├── create_notebook.sh             # Notebook creator launcher
├── list_sources.sh                # Source list launcher
├── upload_source.sh               # Source uploader launcher (interactive)
├── studio_create.sh               # Studio asset generator launcher
├── studio_fetch.sh                # Studio asset fetcher launcher
│
├── question.txt                   # Input: Question text
├── notebook_name.txt              # Input: Name for new notebook
├── source_content.txt             # Input: Custom source text body
├── source_url.txt                 # Input: Website URL link
├── studio_target.txt              # Input: Target Studio asset to generate
├── studio_fetch_target.txt        # Input: Historical asset index/name to retrieve
│
├── notebooks_list.txt             # Output: Dashboard list
├── sources_list.txt               # Output: Notebook sources list
├── studio_assets_list.txt         # Output: Studio assets list
└── response_studio_*.txt          # Output: Retrieved Studio file contents
```
