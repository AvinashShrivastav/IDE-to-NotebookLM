#!/bin/bash
echo "NotebookLM Source Uploader"
echo "--------------------------"
echo "What would you like to upload?"
echo "  [t] Text Content (from source_content.txt)"
echo "  [u] Website Link/URL (from source_url.txt)"
echo ""
read -p "Select option [t/u]: " option

if [[ "$option" == "t" || "$option" == "T" ]]; then
  node --experimental-websocket interact_notebooklm.js --action=upload-text
elif [[ "$option" == "u" || "$option" == "U" ]]; then
  node --experimental-websocket interact_notebooklm.js --action=upload-url
else
  echo "Invalid option. Exiting."
fi
