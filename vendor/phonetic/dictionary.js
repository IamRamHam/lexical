(function () {
    'use strict';

    // The cards use broad US English IPA, with r for [ɹ] and no length marks.
    const symbols = {
        AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'ɛ',
        ER: 'ɝ', EY: 'eɪ', IH: 'ɪ', IY: 'i', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'u',
        B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ',
        K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'r', S: 's',
        SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ'
    };

    // English syllable onsets place the stress mark before the syllable it belongs to.
    const consonantClusters = new Set([
        'B L', 'B R', 'B Y', 'D R', 'D W', 'D Y', 'F L', 'F R', 'F Y',
        'G L', 'G R', 'G W', 'G Y', 'HH Y', 'K L', 'K R', 'K W', 'K Y',
        'L Y', 'M Y', 'N Y', 'P L', 'P R', 'P Y', 'S F', 'S K', 'S L',
        'S M', 'S N', 'S P', 'S T', 'S W', 'S Y', 'SH R', 'T R', 'T W',
        'T Y', 'TH R', 'TH W', 'V Y', 'S K L', 'S K R', 'S K W', 'S K Y',
        'S P L', 'S P R', 'S P Y', 'S T R', 'S T Y'
    ]);

    const converted = new Map();

    function onsetStart(phones, previousVowel, vowel) {
        for (let start = Math.max(previousVowel + 1, vowel - 3); start < vowel; start++) {
            if (start === vowel - 1 && phones[start] !== 'NG') return start;
            if (consonantClusters.has(phones.slice(start, vowel).join(' '))) return start;
        }
        return vowel;
    }

    function transcribe(pronunciation) {
        if (converted.has(pronunciation)) return converted.get(pronunciation);
        const phones = pronunciation.split(' ');
        const vowels = [];
        phones.forEach((phone, index) => {
            if (/[012]$/.test(phone)) vowels.push(index);
        });

        const marks = new Map();
        if (vowels.length > 1) {
            vowels.forEach((vowel, index) => {
                const level = phones[vowel].slice(-1);
                if (level === '0') return;
                const start = index === 0 ? 0 : onsetStart(phones, vowels[index - 1], vowel);
                marks.set(start, level === '1' ? 'ˈ' : 'ˌ');
            });
        }

        const ipa = phones.map((phone, index) => {
            let sound = symbols[phone.replace(/[012]$/, '')];
            if (phone === 'AH0') sound = 'ə';
            if (phone === 'ER0') sound = 'ɚ';
            return (marks.get(index) || '') + sound;
        }).join('');
        converted.set(pronunciation, ipa);
        return ipa;
    }

    function entriesFor(word) {
        const group = window.PhoneticCMU.groups[word.slice(0, 2)];
        if (!group) return null;
        const marker = '\n' + word + ' ';
        const start = group.indexOf(marker);
        if (start < 0) return null;
        const afterWord = start + marker.length;
        return group.slice(afterWord, group.indexOf('\n', afterWord)).split('|');
    }

    function normalize(raw) {
        return raw.normalize('NFKC').trim().replace(/[’‘ʼ]/g, "'").replace(/[‐‑]/g, '-');
    }

    function headword(raw) {
        if (raw === 'US') return 'u.s.';
        return raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    // Choose a representative reading for common homographs in isolation.
    // A caller can pass {previous, next} for the few readings with a clear local cue.
    const commonVariants = {
        read: 1, live: 1, wind: 1, lead: 1, record: 1, dogs: 1,
        pronunciation: 1, pronunciations: 1
    };

    function dictionaryIPA(raw, context) {
        const word = headword(raw);
        const options = entriesFor(word);
        if (!options) return null;
        let variant = commonVariants[word] || 0;
        if (/^résumés?$/i.test(raw)) variant = 2;
        if (context) {
            const previous = typeof context.previous === 'string' ? context.previous.toLowerCase() : '';
            const next = typeof context.next === 'string' ? normalize(context.next) : '';
            if (word === 'the' && next) {
                const nextPhones = entriesFor(headword(next));
                if (nextPhones && /^[A-Z]+[012](?: |$)/.test(nextPhones[0])) variant = 2;
            }
            if (word === 'read' && (/^(has|had|have)$/.test(previous) || /^yesterday$/i.test(next))) variant = 0;
            if (word === 'live' && /^(music|concert|stream|broadcast|show|audience)$/i.test(next)) variant = 0;
            if (word === 'wind' && /^(up|down)$/i.test(next)) variant = 0;
            if (word === 'record' && /^(to|can|could|will|must|should)$/.test(previous)) variant = 2;
        }
        return transcribe(options[variant] || options[0]);
    }

    function lexicalIPA(raw, context) {
        const exact = dictionaryIPA(raw, context);
        if (exact) return exact;
        if (raw.endsWith("'")) return dictionaryIPA(raw.slice(0, -1));
        if (raw.toLowerCase().endsWith("'s")) {
            const stem = dictionaryIPA(raw.slice(0, -2));
            if (!stem) return null;
            if (/[szʃʒ]$/.test(stem)) return stem + 'ɪz';
            if (/[ptkfθ]$/.test(stem)) return stem + 's';
            return stem + 'z';
        }
        return null;
    }

    const smallNumbers = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
    const tens = 'zero ten twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
    const scales = ['', 'thousand', 'million', 'billion', 'trillion'];

    function underThousand(value) {
        const words = [];
        if (value >= 100) words.push(smallNumbers[Math.floor(value / 100)], 'hundred');
        const rest = value % 100;
        if (rest >= 20) {
            words.push(tens[Math.floor(rest / 10)]);
            if (rest % 10) words.push(smallNumbers[rest % 10]);
        } else if (rest || !words.length) {
            words.push(smallNumbers[rest]);
        }
        return words;
    }

    function numberWords(raw) {
        const match = /^([+-]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(raw);
        if (!match) return null;
        const integer = match[2].replace(/,/g, '');
        const words = [];
        if (match[1]) words.push(match[1] === '-' ? 'minus' : 'plus');
        if (/^0\d/.test(integer) || integer.length > scales.length * 3) {
            for (const digit of integer) words.push(smallNumbers[Number(digit)]);
        } else {
            const groups = integer.match(/\d{1,3}(?=(?:\d{3})*$)/g);
            groups.forEach((group, index) => {
                const value = Number(group);
                if (!value && groups.length > 1) return;
                words.push(...underThousand(value));
                const scale = scales[groups.length - index - 1];
                if (scale) words.push(scale);
            });
        }
        if (match[3]) {
            words.push('point');
            for (const digit of match[3]) words.push(smallNumbers[Number(digit)]);
        }
        return words;
    }

    function lookup(word, context) {
        if (typeof word !== 'string') return null;
        const raw = normalize(word);
        if (!raw) return null;
        const number = numberWords(raw);
        if (number) return number.map(part => dictionaryIPA(part)).join(' ');

        const exact = lexicalIPA(raw, context);
        if (exact) return exact;
        if (raw.includes('-')) {
            const components = raw.split('-').map(part => lexicalIPA(part));
            if (components.every(Boolean)) return components.join(' ');
        }
        return null;
    }

    window.PhoneticDictionary = Object.freeze({ lookup, size: window.PhoneticCMU.size });
}());
