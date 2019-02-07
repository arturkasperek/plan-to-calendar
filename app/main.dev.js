/* eslint global-require: 0, flowtype-errors/show-errors: 0 */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `yarn build` or `yarn build-main`, this file is compiled to
 * `./app/main.prod.js` using webpack. This gives us some performance wins.
 *
 * @flow
 */
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import MenuBuilder from './menu';
import fs from 'fs';
import { get } from 'lodash';
const PDFParser = require("pdf2json");

let mainWindow = null;

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

if (
  process.env.NODE_ENV === 'development' ||
  process.env.DEBUG_PROD === 'true'
) {
  require('electron-debug')();
  const path = require('path');
  const p = path.join(__dirname, '..', 'app', 'node_modules');
  require('module').globalPaths.push(p);
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS', 'REDUX_DEVTOOLS'];

  return Promise.all(
    extensions.map(name => installer.default(installer[name], forceDownload))
  ).catch(console.log);
};

const getPdf = (path, pdfParser) => {
  fs.readFile(path, (err, pdfBuffer) => {
    if (!err) {
      pdfParser.parseBuffer(pdfBuffer);
    } else {
      throw err;
    }
  })
};

let toDelete = [];

const formatDate = (hourRange, date) => {
  const start = hourRange.split('-')[0];
  const end = hourRange.split('-')[1];
  const dateClear = date.replace(/(Pt\.|Pon\.|Wt\.|Śr\.|Czw\.|Pon\.|Sb\.|Nd\.)/, '').replace(/\-/g, '/').trim();

  return {
    start: `${dateClear}, ${start}`,
    end: `${dateClear}, ${end}`,
  };
};

const getEventsFromPdfTexts = (texts) => {
  let currentDate = '';
  let events = [];
  let pointer = 0;

  const isDate = item => {
    const itemX = get(item, 'x');

    return itemX > 2.1 && itemX < 2.5;
  };
  const data = texts.slice(18,  texts.length - 1);
  const getColumnData = (incrementOnBreak = true) => {
    let text = '';

    while(true) {
      let currentItem = data[pointer];
      let nextItem = data[pointer + 1];

      if ( !nextItem ) {
        throw new Error('endOfData');
      }

      text += ` ${currentItem.text}`;

      if ( get(currentItem, 'x') !== get(nextItem, 'x') ) {
        if ( incrementOnBreak ) {
          pointer++;
        }
        break;
      } else {
        pointer++;
      }
    }

    return text.trim();
  };

  const getPdfElement = () => {
    const item = data[pointer];
    const itemX = get(item, 'x');
    const columnValue = getColumnData();

    if ( itemX > 0.2 && itemX < 1.5 ) {
      return {
        type: 'hours',
        data: {
          start: formatDate(columnValue, currentDate).start,
          end: formatDate(columnValue, currentDate).end,
        }
      };
    } else if (itemX > 2 && itemX < 2.5) {
      return {
        type: 'date',
        data: {
          date: columnValue
        }
      }
    } else if (itemX > 4.5 && itemX < 5.5) {
      return {
        type: 'type',
        data: {
          type: columnValue,
        }
      };
    } else if (itemX > 6 && itemX < 7.5) {
      return {
        type: 'name',
        data: {
          name: columnValue
        }
      };
    } else if ( itemX > 18 && itemX < 20 ) {
      return {
        type: 'choice',
        data: {
          choice: columnValue
        }
      };
    } else if ( itemX > 21 && itemX < 23) {
      return {
        type: 'room',
        data: {
          room: columnValue
        }
      }
    } else if ( itemX > 23.5 < 25.5 ) {
      return {
        type: 'owner',
        data: {
          owner: columnValue
        }
      }
    } else {
      throw new Error(`Invalid element on PDF ${columnValue}`);
    }
  };

  const getNextEvent = () => {
    let eventToRet = {
      owner: 'n/z',
      start: 'n/z',
      end: 'n/z',
      room: 'n/z',
      name: 'n/z',
      choice: 'n/z',
      type: 'inne',
    };
    let fieldOccurenceFlags = {};
    const isEventReady = () => fieldOccurenceFlags.owner && fieldOccurenceFlags.hours && fieldOccurenceFlags.room && fieldOccurenceFlags.name && fieldOccurenceFlags.choice && fieldOccurenceFlags.type;

    while (true) {
      const pointerBeforeElementGet = pointer;
      const element = getPdfElement();
      const elementType = element.type;

      if ( elementType == 'date' ) {
        currentDate = element.data.date;
      } else {
        eventToRet = {
          ...eventToRet,
          ...element.data
        };

        if ( fieldOccurenceFlags[element.type] == true ) {
          pointer = pointerBeforeElementGet;

          break;
        }

        fieldOccurenceFlags = {
          ...fieldOccurenceFlags,
          [element.type]: true
        }
      }

      if ( isEventReady()) {
        break;
      }
    }

    return eventToRet;
  };

  while (true) {
    try {
      events.push(getNextEvent());
    } catch (e) {
      if ( e.message == 'endOfData' ) {
        break;
      } else {
        throw e;
      }
    }
  }

  console.log('events are ');
  events.forEach((ev) =>console.log(ev.name));
  return events.filter(event => toDelete.indexOf(event.name) == -1);

  //events.push()
};

const generateCSVFromEvents = (events) => {
  const head = 'Subject,Start Date,Start Time,End Date,End Time,Description,Location\n';

  return head + events.reduce((acc, event) => {
    acc += `${event.type} - ${event.name}, ${event.start}, ${event.end}, ${event.owner}${event.choice != '-' ? ` - ${event.choice}` : ''}, ${event.room}\n`;
    return acc;
  }, '');
};

ipcMain.on('PLAN_GENERATE', (event, arg) => {
  const pdfFilePath = arg.pdfFilePath;
  const pdfParser = new PDFParser();

  toDelete = arg.toDelete;

  pdfParser.on("pdfParser_dataReady", pdfData => {
    const texts = pdfData.formImage.Pages.reduce((acc, val) => {
      const items = val.Texts.map(i=>({
        text: decodeURIComponent(i.R[0].T).trim(),
        x: i.x,
        y: i.y
      }));
      acc = [...acc, ...items];
      return acc;
    }, []);
    const events = getEventsFromPdfTexts(texts);
    const planCsv = generateCSVFromEvents(events);
    const saveToPath = dialog.showSaveDialog({
      filters: [{
        name: 'CSV File',
        extensions: ['csv']
      }]
    });

    if ( saveToPath ) {
      fs.writeFile(saveToPath, planCsv, (err) => {
        if ( err ) {
          throw e;
        }
      });
    }

    console.log('save to path is', saveToPath);
  });

  getPdf(pdfFilePath, pdfParser);

  event.returnValue = 4;
});

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  console.log('ha ;(');
  app.quit();
});

app.on('ready', async () => {
  if (
    process.env.NODE_ENV === 'development' ||
    process.env.DEBUG_PROD === 'true'
  ) {
    await installExtensions();
  }

  mainWindow = new BrowserWindow({
    show: false,
    width: 400,
    height: 700,
    resizable: false
  });

  mainWindow.loadURL(`file://${__dirname}/app.html`);

  // @TODO: Use 'ready-to-show' event
  //        https://github.com/electron/electron/blob/master/docs/api/browser-window.md#using-ready-to-show-event
  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();
});
