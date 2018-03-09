// TODO: When bestDef returns false, we break. That's bad, fix it.
var
fs = require('fs'),
request = require('node-fetch'),
asyncHelper = require('async'),
queryString = require('querystring'),
FormData = require('form-data'),
ankiWords = [],
timeout = 1000;

function parseWordList(wordBlob) {
    function cleanQuotes(badQuotes) {
        if (badQuotes) {
            return badQuotes.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
        }
    }

    var
    wordList = wordBlob.trim(),
    listRegex = /^.*?([a-zA-Z].*)\s+-\s+(.*)/;

    ankiWords = []; // clear up our array

    if (wordList.length) {
        wordList = wordBlob.trim().split('\n');
    }

    for (var i = 0; i < wordList.length; i++) {
        var
        parsedDefinition = listRegex.exec(wordList[i]),
        romaji,
        meanings;

        try {
            romaji = parsedDefinition[1],
            meanings = parsedDefinition[2];

            meanings = cleanQuotes(meanings);
            meanings = meanings.split(' | ');
            for (var j = 0; j < meanings.length; j++) {
                meanings[j] = meanings[j].split(/\s+\/\s+/);
            }

            ankiWords.push({
                romaji: romaji,
                meanings: meanings
            });
        } catch (e) {
            error('Problem parsing word ' + wordList[i] + '.', e);
        }
    }

    if (ankiWords.length) {
        requestWords(ankiWords);
    } else {
        error("No words to request.");
    }
}

function requestWords(wordList) {
    asyncHelper.each(wordList, async (partialWordData, done) => {
        try {
            const wordJishoData = await getWordDataFromJisho(partialWordData);
            await getAudioForWord(wordJishoData);
            setTimeout(done, timeout);
        } catch (err) {
            error('failed somewhere for ' + partialWordData.romaji + ' err: ' + err);
        }
    }, output);
}

async function getWordDataFromJisho(wordObject) {
    var
    apiUrl = 'http://jisho.org/api/v1/search/words?keyword=',
    wordUrl = apiUrl + encodeURIComponent(wordObject.romaji),
    self = this,
    passedArgs = arguments;

    try {
        console.log('requesting ' + wordObject.romaji);
        const response = await request(wordUrl);
        const json = await response.json();
        return jishoResponseProcessor(wordObject, json);
    } catch (err) {
        error(wordObject.romaji + " request error: " + err + ". Retrying.");
        // An error occurred, this will re-do the request.
        // requestWord.apply(self, passedArgs);
    }
}

function jishoResponseProcessor(wordObject, response) {
    if (response && response.data && response.meta && response.meta.status === 200) {
        var
        definitions = response.data,
        bestDefinition = getClosest(wordObject, definitions);

        if (bestDefinition) {
            addToAnki(wordObject, bestDefinition);
            return wordObject;
        } else {
            return wordObject;
        }
    }
}

async function getAudioForWord(wordObject, callback) {
    var
    apiUrl = 'https://www.japanesepod101.com/learningcenter/reference/dictionary_post';

    const form = new FormData();
    form.append('post', 'dictionary_reference');
    form.append('match_type', 'exact');
    form.append('search_query', wordObject.kana);
    form.append('vulgar', 'true');

    try {
        await fs.exists('collection.media/' + wordObject.romaji + '.mp3', async function(exists) {
            if (!exists) {
                try {
                    const response = await request(apiUrl, {
                        method: 'POST', 
                        body: form
                    });
                    const pageHTML = await response.text();
                    await jpodHTMLParser(wordObject, pageHTML);
                } catch(err) {
                    error('error getting audio for word' + wordObject.romaji + '. error: ' + err);
                }
            } else {
                wordObject.audio = '[sound:' + wordObject.romaji + '.mp3]';
            }
        });
    } catch(err) {
        error('Error reading file for ' + wordObject.romaji + '. Error:' + err);
    }
}

async function jpodHTMLParser(wordObject, pageHTML) {
    var
    audioURLRegex = /https:\/\/www.japanesepod101.com\/learningcenter\/audio\/vocabulary\/\d+.mp3/,
    audioUrl;

    try {
        audioUrl = audioURLRegex.exec(pageHTML)[0];

        if (audioUrl) {
            try {
                const response = await request(audioUrl);
                const body = await response.body;
                await body.pipe(fs.createWriteStream('collection.media/' + wordObject.romaji + '.mp3'));
            } catch (err) {
                error('Error requesting MP3 file for ' + wordObject.romaji + '. error: ' + err);
            }
            wordObject.audio = '[sound:' + wordObject.romaji + '.mp3]';
        }
    } catch (e) {
        //error('Could not parse audio information for ' + wordObject.romaji);
    }

    return wordObject;
}

function getClosest(wordObject, definitions) {
    function getSeparateWords(meaningsArr) {
        // https://dreaminginjavascript.wordpress.com/2008/08/22/eliminating-duplicates/
        function eliminateDuplicates(arr) {
            var i,
            len=arr.length,
            out=[],
            obj={};

            for (var i=0;i<len;i++) {
                obj[arr[i]]=0;
            }
            for (var i in obj) {
                out.push(i);
            }
            return out;
        }

        function lowerCaseAll(arr) {
            for (var i = 0; i < arr.length; i++) {
                arr[i] = arr[i].toLowerCase();
            }

            return arr;
        }

        function stripUnwanted(arr) {
            var wantedRegex = /[^a-zA-Z0-9]/g;

            for (var i = 0; i < arr.length; i++) {
                arr[i] = arr[i].replace(wantedRegex, '');
            }

            return arr;
        }

        var
        combinedArr,
        wordArr = [];

        if (typeof meaningsArr[0] === 'object' && meaningsArr.length > 1) {
            // If we have an array with two different 'senses', we flatten it here.
            meaningsArr.reduce(function(a, b) {
                if (a && b) {
                    combinedArr = a.concat(b);
                }
            });
        } else if (typeof meaningsArr[0] === 'string') {
            combinedArr = meaningsArr;
        } else {
            combinedArr = meaningsArr[0];
        }

        for (var i = 0; i < combinedArr.length; i++) {
            if (combinedArr[i].indexOf(' ')) {
                wordArr = wordArr.concat(combinedArr[i].split(' '));
            }
        }

        wordArr = eliminateDuplicates(wordArr);
        wordArr = lowerCaseAll(wordArr);
        wordArr = stripUnwanted(wordArr);

        return wordArr;
    }

    var
    myWords = getSeparateWords(wordObject.meanings),
    bestDefinition = definitions[0];

    if (!bestDefinition) {
        warn('No words found for ' + wordObject.romaji);
        return false;
    }

    for (var i = 0; i < definitions.length; i++) {
        var
        def = definitions[i],
        senses = def.senses,
        englishArr = [];

        def.points = 0;

        for (var j = 0; j < senses.length; j++) {
            englishArr = englishArr.concat(senses[j].english_definitions);
        }

        englishArr = getSeparateWords(englishArr);

        for (var j = 0; j < myWords.length; j++) {
            for (var k = 0; k < englishArr.length; k++) {
                if (myWords[j] == englishArr[k]) {
                    def.points++;
                    break;
                }
            }
        }

        if (def.points == myWords.length) {
            bestDefinition = def;
            break;
        } else if (def.points > 0 && def.points < myWords.length && def.points > bestDefinition.points) {
            bestDefinition = def;
        }
    }

    if (bestDefinition.points != myWords.length) {
        if (bestDefinition.points === 0) {
            warn('No match! ' + Math.floor((bestDefinition.points / myWords.length) * 100) + '% for ' + wordObject.romaji + '. Mine: "' + getSeparateWords(wordObject.meanings).toString() + '" Closest Jisho: "' + getSeparateWords(bestDefinition.senses[0].english_definitions).toString() + '"');
            return false;
        } else {
            warn('Iffy match. ' + Math.floor((bestDefinition.points / myWords.length) * 100) + '% for ' + wordObject.romaji + '. Mine: "' + getSeparateWords(wordObject.meanings).toString() + '" Jisho: "' + getSeparateWords(bestDefinition.senses[0].english_definitions).toString() + '"');
        }
    }

    return bestDefinition;
}

function addToAnki(wordObject, definition) {
    // TODO: Find out when definition.japanese array can have more than one result.
    var
    tags = [],
    isCommon = definition.is_common,
    partsOfSpeech = definition.senses[0].parts_of_speech, // Don't just grab the first sense, each sense is pretty much a different meaning and can change parts of speech, etc.
    jishoTags = definition.tags;

    // my default tag
    tags.push('daniel');
    tags.push('script');

    if (isCommon) {
        tags.push('common');
    }

    if (partsOfSpeech.length) {
        for (var i = 0; i < partsOfSpeech.length; i++) {
            if (partsOfSpeech[i]) {
                tags.push(partsOfSpeech[i]);
            }
        }
    }

    if (jishoTags.length) {
        for (var i = 0; i < jishoTags.length; i++) {
            if (jishoTags[i]) {
                tags.push(jishoTags[i]);
            }
        }
    }

    // Normalize tags by making them lowercase.
    if (tags.length) {
        for (var i = 0; i < tags.length; i++) {
            if (tags[i]) {
                tags[i] = tags[i].toLowerCase();
                tags[i] = tags[i].split(' ').join('_');
            }
        }
    }

    wordObject.kanji = definition.japanese[0].word || definition.japanese[0].reading;
    wordObject.kana = definition.japanese[0].reading;
    wordObject.explanation = '';
    wordObject.tags = tags;
}

function output(err) {
    function meaningsToOutputFormat(meanings) {
        var output;

        for (var i = 0; i < meanings.length; i++) {
            var
            meaningCount = meanings[i].length,
            lastCommaPos,
            orStyle,
            lastCharIsNonWord = /\W$/,
            lastChar;

            meanings[i] = meanings[i].join(', ');
            meanings[i] = meanings[i].charAt(0).toUpperCase() + meanings[i].slice(1); // uppercase first letter
            lastCommaPos = meanings[i].lastIndexOf(', ');

            if (meaningCount > 2) {
                orStyle = ', or ';
            } else {
                orStyle = ' or ';
            }

            if (lastCommaPos != -1) {
                // swap out last comma for "or" eg "run, fast, quick" => "run, fast or quick"
                meanings[i] = meanings[i].substring(0, lastCommaPos) + orStyle + meanings[i].substring(lastCommaPos + 2);
            }

            lastChar = meanings[i].slice(-1);

            // Add a period to the end if there's no punctuation
            if (!lastCharIsNonWord.test(lastChar)) {
                meanings[i] = meanings[i] + ".";
            }

        }

        output = meanings.join("\r\n").split('"').join("'"); // separate by line break and replace quotes with single quotes

        output = '"' + output + '"';

        return output;
    }

    ankiWords.reverse(); // Sort by oldest words to newest so that anki shows them in chronological order.

    var output = ankiWords.map(function(wordObject) {
        return [
            wordObject.kanji,
            wordObject.kana,
            meaningsToOutputFormat(wordObject.meanings),
            wordObject.explanation,
            wordObject.audio,
            (wordObject.tags ? wordObject.tags.join(' ') : '')
        ].join(';');
    }).join("\r\n");

    fs.appendFile('output.txt', output, {encoding: 'utf-8'}, function(err) {
        if (err) {
            error(err);
            throw err;
        }
    });
}

function error(error) {
    console.error(error || error.message);
    fs.appendFile('error.txt', 'Err: ' + error + "\r\n");
}

function warn(message) {
    console.warn(message);
    fs.appendFile('warn.txt', message + "\r\n");
}

// Clear the output and error files on load
fs.writeFileSync('output.txt', '', {encoding: 'utf-8'});
fs.writeFileSync('error.txt', '', {encoding: 'utf-8'});
fs.writeFileSync('warn.txt', '', {encoding: 'utf-8'});
fs.exists('collection.media/', function(exists) {
    if (!exists) {
        fs.mkdirSync('collection.media');
    }
});

var wordFile = fs.readFile('wordlist.txt', {encoding: 'utf-8'}, function(err, data) {
    if (err) {
        error(err);
        throw err;
    }

    parseWordList(data);
});
