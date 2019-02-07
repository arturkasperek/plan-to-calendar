import React, { Component } from 'react';
import Dropzone from 'react-dropzone';
import { ipcRenderer } from 'electron';

export default class Root extends Component<Props> {
  state = {
    selectedFile: undefined,
    toDelete: ''
  };

  onFileDrop = (file) => {
    this.setState({
      selectedFile: file[0],
    });
  };

  generatePlan = () => {
    this.generatePlanAndSaveOnDisc()
  };

  generatePlanAndSaveOnDisc = () => {
    ipcRenderer.send('PLAN_GENERATE', {
      pdfFilePath: this.state.selectedFile.path,
      toDelete: this.state.toDelete.replace('\n', '').split(';'),
    });
  };

  updateToDelete = (e) => {
    this.setState({
      toDelete: e.target.value,
    })
  };

  render() {
    return (
      <div className={'main-wrapper container'}>
        <div className={'drop-wrapper'}>
          <div className={'drop-container'}>
            <Dropzone className={'drop-area'} accept={['application/pdf']} multiple={false} onDrop={this.onFileDrop}>
              <p>Dodaj ( lub upuść ) plik PDF</p>
            </Dropzone>
            {this.state.selectedFile && (
              <div className={'load-info'}>Załadowany: {this.state.selectedFile.name}</div>
            )}
          </div>
        </div>
        <div className={'seperator'}></div>
        <div className={'delete-function-holder'}>
          <div><h5>Usuń wydarzenia</h5></div>
          <div><span className={'small'}>Dodaj nazwy przedmiotów ktrych nie chcesz dodawać oddzielając ";"</span></div>
          <div><textarea value={this.state.toDelete} onChange={this.updateToDelete} className={'subjects-holder'} /></div>
        </div>
        <div className={'generate-btn-wrapper'}>
          <button className={'btn btn-primary'} onClick={this.generatePlan} disabled={!this.state.selectedFile}>Zapisz CSV</button>
        </div>
      </div>
    );
  }
}
