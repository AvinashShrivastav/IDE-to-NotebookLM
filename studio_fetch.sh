#!/bin/bash
echo "========================================="
echo "NotebookLM Studio Asset Fetcher"
echo "========================================="
echo "What would you like to do?"
echo "  [l] List all generated assets/files"
echo "  [d] Download/retrieve the full contents of an asset"
echo "========================================="
read -p "Select option [l/d]: " option

if [[ "$option" == "l" || "$option" == "L" ]]; then
  echo "Fetching generated assets history..."
  node --experimental-websocket interact_notebooklm.js --action=studio-list
  echo ""
  if [ -f "studio_assets_list.txt" ]; then
    cat studio_assets_list.txt
  fi
elif [[ "$option" == "d" || "$option" == "D" ]]; then
  read -p "Enter asset index (e.g., 1) or title to retrieve: " target
  if [ -z "$target" ]; then
    echo "No target entered. Exiting."
    exit 1
  fi
  echo "$target" > studio_fetch_target.txt
  echo "Saved target: $target (Saved to studio_fetch_target.txt)"
  echo "Opening and retrieving file..."
  node --experimental-websocket interact_notebooklm.js --action=studio-fetch-item
else
  echo "Invalid option. Exiting."
fi
