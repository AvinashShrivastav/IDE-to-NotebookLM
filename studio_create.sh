#!/bin/bash
echo "========================================="
echo "NotebookLM Studio Asset Generator"
echo "========================================="
echo "Which Study Guide/Asset would you like to create?"
echo "  [1] Audio Overview"
echo "  [2] Slide Deck"
echo "  [3] Video Overview"
echo "  [4] Mind Map"
echo "  [5] Reports"
echo "  [6] Flashcards"
echo "  [7] Quiz"
echo "  [8] Infographic"
echo "  [9] Data Table"
echo "========================================="
read -p "Select option [1-9]: " choice

target=""
case $choice in
  1) target="Audio Overview";;
  2) target="Slide Deck";;
  3) target="Video Overview";;
  4) target="Mind Map";;
  5) target="Reports";;
  6) target="Flashcards";;
  7) target="Quiz";;
  8) target="Infographic";;
  9) target="Data Table";;
  *) echo "Invalid choice. Exiting."; exit 1;;
esac

echo "$target" > studio_target.txt
echo "Selected target: $target (Saved to studio_target.txt)"
echo "Starting generation..."
node --experimental-websocket interact_notebooklm.js --action=studio-create
