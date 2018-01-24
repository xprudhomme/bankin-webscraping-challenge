/* jshint node: true */
/* jshint globalstrict: true */
"use strict";

/**
 * USAGE example:
 * node bankin-challenge.js
 */


/**
 * Modules requirements 
 */
const puppeteer = require('puppeteer');
const fs = require('fs');


let browser = null;


/**
 * Execute a function within a page context, after injecting
 * a utils function in the same page context beforehand
 * @param {Page} page 
 * @param {Function} utilsFunction
 * @param {!Promise<Serializable>} pageFunction 
 */
async function evaluateWithUtils(page, utilsFunction, pageFunction) {
    await page.evaluate(utils);
    return await page.evaluate(pageFunction);
}




/**
 * Write a JSON object to a target file
 * @param {String} jsonObj      JSON to be saved on our local disk
 * @param {String} targetFile   Target file path + name. The .json extension can be ommited
 */
async function saveToJSONFile(jsonObj, targetFile) {
    
    if(!/\.json$/.test(targetFile))
        targetFile+= ".json";

    // The returned Promise is rejected if the JSON object cannot be serialized properly
    // or if the target file cannot be written successfully
    return new Promise((resolve, reject) => {
        let data;

        // Make sure our object is only a JSON objet (serializable)
        try {
            data = JSON.stringify(jsonObj);
        }
        catch (err) {
            console.log(` [saveToJSONFile] Could not serialize JSON object! Error: ${err}`);
            reject(err);
        }
            
        // Try saving the file. Reject with error if an issue arises
        fs.writeFile(targetFile, data, (err, text) => {

            if(err) {
                console.log(` [saveToJSONFile] Could not write JSON to file ! Error: ${err}`);
                reject(err);
            }
            else {
                resolve(targetFile);
            }
        });
    });
}


/**
 * Utils function to be injected within browser page context
 */
const utils = () => {

    /**
     * Retrieves all Nodes matching a given XPath expression.
     *
     * @param  {string}     expression  The XPath expression
     * @param  {Node}       scope      Node element to search child nodes within
     * @return {Array}
     */
    window.getElementsByXPath = (expression, scope=document) => {
        let nodes = [];
        let a = document.evaluate(expression, scope, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < a.snapshotLength; i++) {
            nodes.push(a.snapshotItem(i));
        }
        return nodes;
    };
    
    /**
     * Retrieves a single Node matching a given XPath expression.
     *
     * @param  {string}     expression  The XPath expression
     * @param  {Node}       scope       Node element to search child node within
     * @return {Node|null}
     */
    window.getElementByXPath = (expression, scope=document) => {
        let a = document.evaluate(expression, scope, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        if (a.snapshotLength > 0) {
            return a.snapshotItem(0);
        }
    };


    /**
     * Retrieve a Node element text contents
     * @param {Node} elem   Node element to get the text contents from
     * @param {string} regex Regex defining the pattern for substring extraction
     */
    window.getText = (elem, regex=null) => {
         let res = elem.textContent || elem.innerText || elem.value || '';
         return regex === null? res: extract(res, regex);
    };


    /**
     * Given an XPath expression, retrieve its matching node element text contents
     * @param {string} expression   The XPath expression
     * @param {Node} scope          Node element to search child node within
     * @param {string} regex        Regex defining the pattern for substring extraction
     */
    window.getElementTextFromXPath = (expression, scope=document, regex=null) => {
        return getText(getElementByXPath(expression, scope), regex);
    };


    /**
     * Extract a string's substring, given a regex pattern
     * @param {string} data                 Main string to extract the substring from
     * @param {RegexP|string} regexparam    Pattern to use for substring matching
     * @return {string}
     */
    window.extract = (data, regexparam) => {

        let regex = regexparam, datares = '', isNum = false;

        // Make sure we don't try to extract substring from null-string
        if(!data) {
            return null;
        }

        // Convert string regex to a RegExp object
        if(typeof regexparam === 'string' || regexparam instanceof String) {

            if(/\(\\d\+\)/.test(regexparam)) {
                isNum=true;
            }

            regex = new RegExp(regexparam);
        }

        // If regex is a valid regex object, extract data
        if (regex !== null && (regex instanceof RegExp || (regex === Object(regex) && regex.constructor.name==="RegExp"))) {

            rgxres = data.match(regex);

            if(rgxres !== null && rgxres!==undefined) {

                datares = rgxres[1];

                if(isNum) {
                    datares = parseInt(rgxres[1]);
                }
            }
            return datares;
        }
        else return data;
    };


    /**
     * Given an HTML table rows XPath selector, extract the full table data as a JSON list
     * @param {string} rowsXPath    XPath matching HTML table rows nodes to extract data from
     * @return {Array}
     */
    window.getTableData = (rowsXPath) => {

        let rows = getElementsByXPath(rowsXPath);

        let tabledata = rows.map( (row) => {
            return {
                account: getElementTextFromXPath("td[1]", row),
                transaction: getElementTextFromXPath("td[2]", row, "Transaction\\s(\\d+)"),
                amount: getElementTextFromXPath("td[3]", row, "(\\d+)"),
                currency: getElementTextFromXPath("td[3]", row, "\\d+([^0-9,\\.]+)"),
            };
        });

        return tabledata;
    };
};




/**
 * Open page and make sure no error is displayed
 * @param {Page} page 
 * @param {string} url 
 */
async function openWithoutError(page, url) {

    // Register an 'on dialog' event handler
    page.on('dialog', async dialog => {

	// Necessary because of Puppeteer API Changes between v0.13.0 and v1.0.0
	const dialogType = dialog.type instanceof Function? dialog.type() : dialog.type;

        if( dialogType === 'alert') { // Handle dialog of type alert only

            console.log(' [openWithoutError.onalert] Got alert message: ' + dialog.message());

            // Close the alert box
            await dialog.dismiss();

            // Add an 'alertdetected' flag within the page's window element
            await page.evaluate( () => window.alertdetected = true);
        }
    });

    await page.goto(url)
    .then( () => {
        console.log(` [openWithoutError] Just opened: ${url}`);
    });

    // Check page status and retry if needed
    return checkStatus(page);
}


/**
 * Check the page loading status: three situations can happen
 *  1 - Main data table is displayed (no iframe)
 *  2 - Data table is displayed within an iframe
 *  3 - An alert pops in with message 'Oops! Something went wrong'
 * @param {Page} page 
 */
async function checkStatus(page) {

    // Let's have a race: whichever is displayed first wins !
    // Candidates: the Main Table, the iframe with inner table, and the Alert popin
    let pageres = await Promise.race([        
        page.waitForSelector('#dvTable>table').then( () => "MAIN_TABLE_FOUND"),
        page.waitForSelector('iframe#fm').then( () => "IFRAME_FOUND"),
        page.waitForFunction('window.alertdetected!==undefined').then( () => "ALERT_DETECTED")
    ]);

    // RETRY IF an alert has popup with message 'Oops! Something went wrong'
    if(pageres==='ALERT_DETECTED') {
        // Click on the 'Reload Transactions' input button
        await page.click('#btnGenerate');
        // Check status again
        return checkStatus(page);
    }
    // ELSE proceed to next step, passing along the table found flag
    else return pageres;
}


/**
 * Retrieve current page table data (covers both situations: main table and iframe inner table)
 * @param {Page} page 
 * @param {string} pagestatus 
 */
async function getTableData(page, pagestatus) {

    let tabledata;

    switch(pagestatus) {

        case "MAIN_TABLE_FOUND":

            tabledata = await evaluateWithUtils(page, utils, () => {

                const tableRowsXPath = "//div[@id='dvTable']/table//tr[not(th)]";
                return getTableData(tableRowsXPath);
                
            });

        break;

        case "IFRAME_FOUND":

            const frames = await page.frames();
            const iframe = frames.find(f => f.name() === 'fm');

            tabledata = await evaluateWithUtils(iframe, utils, () => {

                const tableRowsXPath = "//table[@border]//tr[not(th)]";
                return getTableData(tableRowsXPath);
            });

        break;
    }

    return tabledata;
}


/**
 * Main process
 */
(async function run() {

    // Start logging time
    console.time("fullprocessruntime");

    // Let's start our Chrome browser instance
    browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'], // Disable the sandbox when is server mode
        headless: true,                                     // Turn headless true
    });

    /**
     * Number of pages process to run in parallel
     */
    const N = 100;

    /**
     * Get an array of integers, from 1 to N
     * @param {integer} N 
     */
    const getRange = N => Array.from(new Array(N), (val,index)=>index+1);

    let allrecords = [], pagesPromises = [];

    // Let's parallelize the whole process: N requests at a time
    getRange(N).forEach((page) => {
        pagesPromises.push(openNewPageAndBrowse(page));
    });
    
    // Once all the pages promises have resolved, get the data and close browser
    let tablesdata = await Promise.all(pagesPromises);
    await browser.close()

    // Concat all of the pages tables data
    for(let table of tablesdata) {
        allrecords.push(...table);
        //console.log(` Table ${tablesdata.indexOf(table)} data: ${JSON.stringify(table, null, 2)}`);
    }

    // Save whole tables data to JSON file
    await saveToJSONFile(allrecords, '/tmp/allrecords.json');

    // End log time
    console.timeEnd("fullprocessruntime");
})();


/**
 * Open a new page, given a specific page number
 * @param {integer} pagenum
 */
async function openNewPageAndBrowse(pagenum) {

    // Compute current page url
    const baseurl = 'https://web.bankin.com/challenge/index.html';
    const url = pagenum===1? baseurl : `${baseurl}?start=${(pagenum-1)*50}`;

    // Open page and get status
    let page = await browser.newPage();
    let pagestatus = await openWithoutError(page, url);

    console.log(" [openNewPageAndBrowse] I'm ok ! Got: " + pagestatus);

    // Extract table data
    let tabledata = await getTableData(page, pagestatus);

    await page.close();
    return tabledata;
}
