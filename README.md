## Your Japanese Vocab in Anki

This script will turn a Japanese vocab list into an Anki-importable text file.

## Requirements

You'll need [node.js](https://nodejs.org/en/download/).

## Vocab List Format

Your word list must be in this format in a file called `wordlist.txt`:

```
oboeru - to memorize | to learn / to pick up
gengo - language
```

## Code Example

`node index.js` is all you need to get the script running.

It will fetch word data from [Jisho](http://jisho.org/) and audio data from [JapanesePod101](http://www.japanesepod101.com/). Audio data will be stored in `collection.media/`. These audio files must be merged in with your Anki media folder. [Instructions for that are here.](http://ankisrs.net/docs/manual.html#importing-media)