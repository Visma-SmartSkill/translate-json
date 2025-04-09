#!/usr/bin/env node

const fs = require('fs');
const moment = require('moment');
const _ = require('lodash');
const path = require('path');
const agent = require('superagent-promise')(require('superagent'), Promise);
const { translate } = require("google-translate-api-browser");
let dicc = {};

//Lang Codes https://ctrlq.org/code/19899-google-translate-languages

if (process.argv.length >= 2) {

    process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;
    //Args
    const inputFile = path.basename(process.argv[2]);
    const fileName = path.parse(inputFile).name;
    const destinationCodes = ['nn'];
    const basePath = path.dirname(path.relative('./', process.argv[2]));

    const nynoUrl = _.template('https://5161.nynorobot.no:3780/translateText?stilmal=Moderat nynorsk&q=<%= value %>');

    const transformResponse = (res) => {
        let d = JSON.parse(res.text);
        let txt = _.get(d, 'responseData.translatedText', '');
        txt = txt.trim();
        if (txt.endsWith(' 0')) txt = txt.substring(0, txt.length - 2);
        return txt;
    }
    const transformFree = (res) => {
		return _.lowerFirst(_.get(res, 'text', ''));
    }

    const getCache = (languageKey) => {
        try {
            dicc[languageKey] = {};
            let fileContent = fs.readFileSync(path.join(basePath, `translateCache-${languageKey}.txt`), 'utf-8').split(/\r?\n/);
            fileContent.map((line)=> {
                let cached = line.split('|');
                if(cached[0]) dicc[languageKey][cached[0]] = cached[1];
            });
        } catch (error) {

        }
    }
    const cachedIndex = (key, value, languageKey) => {
        const line = key + '|' + value + '\n';
        dicc[languageKey][key] = value;
        fs.appendFileSync(path.join(basePath, `translateCache-${languageKey}.txt`), line);
        return value;
    }

    function iterLeaves(value, keyChain, accumulator, languageKey) {
        accumulator = accumulator || {};
        keyChain = keyChain || [];
        if (_.isObject(value)) {
            return _.chain(value).reduce((handlers, v, k) => {
                return handlers.concat(iterLeaves(v, keyChain.concat(k), accumulator, languageKey));
            }, []).flattenDeep().value();
        } else {
            if(typeof value !== 'string')
                return value;

            return function () {
				const path = _.join(keyChain, '.');
                if(!(path in dicc[languageKey])) {
                    console.log(_.template('Translating <%= value %> to <%= languageKey %>')({value, languageKey}));
                    let prom = agent('GET', nynoUrl({
                        value: encodeURI(value + ' 0')
                    })).retry(5).then(transformResponse);

                    return prom.then((res) => cachedIndex(path, res, languageKey))
                    .catch((err) => console.log(err))
                    .then((text) => {
                        //Sets the value in the accumulator
                        _.set(accumulator, keyChain, text);

                        //This needs to be returned to it's eventually written to jsona
                        return accumulator;
                    });
                }
                else {
                    console.log(value + ' cached: ' + '(' + dicc[languageKey][path] + ')');
                    _.set(accumulator, keyChain, dicc[languageKey][path]);
                    return accumulator;
                }
            };
        }
    }

    Promise.all(_.reduce(destinationCodes, (sum, languageKey) => {
        const fileName = _.template(path.join(basePath, './<%= languageKey %>.json'))({
            languageKey,
            timeStamp: moment().unix()
        });

        //read languageKey Cache.
        getCache(languageKey);
        let content = JSON.parse(fs.readFileSync(path.join(basePath, inputFile), 'utf-8'));
        //Starts with the top level strings
        return sum.concat(
            _.reduce(iterLeaves(content, undefined, undefined, languageKey), (promiseChain, fn) => {
            return promiseChain.then(fn);
        }, Promise.resolve()).then((payload) => {
            fs.writeFileSync(fileName, JSON.stringify(payload, null, 2));
        }).then(_.partial(console.log, 'Successfully translated all nodes, file output at ' + fileName)));
    }, [])).then(() => {
        process.exit();
    });

} else {
    console.error('You must provide an input json file and a comma-separated list of destination language codes.');
}