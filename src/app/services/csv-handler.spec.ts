import { TestBed } from '@angular/core/testing';

import { CsvHandlerService } from './csv-handler';

describe('CsvHandlerService', () => {
  let service: CsvHandlerService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(CsvHandlerService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('parseCSV', () => {
    it('parsea con el delimitador por defecto (coma)', () => {
      service.setCsv('a,b,c\n1,2,3');
      service.parseCSV();

      expect(service.parsedData()).toEqual([
        ['a', 'b', 'c'],
        ['1', '2', '3'],
      ]);
    });

    it('parsea con un delimitador raro (punto y coma)', () => {
      service.setCsv('a;b;c\n1;2;3');
      service.selectedDelimiter.set(';');
      service.parseCSV();

      expect(service.parsedData()).toEqual([
        ['a', 'b', 'c'],
        ['1', '2', '3'],
      ]);
    });

    it('parsea con delimitador pipe y tabulador', () => {
      service.setCsv('a|b|c');
      service.selectedDelimiter.set('|');
      service.parseCSV();

      expect(service.parsedData()).toEqual([['a', 'b', 'c']]);
    });

    it('conserva las lineas vacias como filas vacias', () => {
      service.setCsv('a,b\n\nc,d');
      service.parseCSV();

      expect(service.parsedData()).toEqual([
        ['a', 'b'],
        [''],
        ['c', 'd'],
      ]);
    });

    it('parsea correctamente con saltos de linea CRLF', () => {
      service.setCsv('a,b\r\nc,d');
      service.selectedLineBreak.set('\r\n');
      service.parseCSV();

      expect(service.parsedData()).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });

    it('reinicia las filas seleccionadas al parsear', () => {
      service.setCsv('a,b\nc,d');
      service.toggleRowSelection(0);
      expect(service.selectedRows()).toEqual([0]);

      service.parseCSV();

      expect(service.selectedRows()).toEqual([]);
    });

    it('no hace nada si no hay csv cargado', () => {
      service.parseCSV();

      expect(service.parsedData()).toBeNull();
    });

    it('no parsea si no hay delimitador seleccionado', () => {
      service.setCsv('a,b\nc,d');
      service.selectedDelimiter.set('');
      service.parseCSV();

      expect(service.parsedData()).toBeNull();
    });
  });

  describe('toggleRowSelection', () => {
    it('agrega la fila cuando no estaba seleccionada (toggle on)', () => {
      service.toggleRowSelection(2);

      expect(service.selectedRows()).toEqual([2]);
    });

    it('quita la fila cuando ya estaba seleccionada (toggle off)', () => {
      service.toggleRowSelection(2);
      service.toggleRowSelection(2);

      expect(service.selectedRows()).toEqual([]);
    });

    it('mantiene las demas filas al togglear una (off selectivo)', () => {
      service.toggleRowSelection(0);
      service.toggleRowSelection(1);
      service.toggleRowSelection(0);

      expect(service.selectedRows()).toEqual([1]);
    });
  });

  describe('possibleDelimiters / possibleLineBreaks', () => {
    it('detecta solo los delimitadores presentes en el csv', () => {
      service.setCsv('a,b;c');

      expect(service.possibleDelimiters()).toEqual([',', ';']);
    });

    it('detecta los saltos de linea presentes (CRLF y LF)', () => {
      service.setCsv('a\r\nb');

      expect(service.possibleLineBreaks()).toEqual(['\n', '\r\n', '\r']);
    });

    it('devuelve null cuando no hay csv cargado', () => {
      expect(service.possibleDelimiters()).toBeNull();
      expect(service.possibleLineBreaks()).toBeNull();
    });
  });

  describe('reset', () => {
    it('limpia el csv, los datos parseados, la seleccion y el localStorage', () => {
      service.setCsv('a,b\nc,d');
      service.parseCSV();
      service.toggleRowSelection(1);
      localStorage.setItem('current-csv', JSON.stringify('a,b\nc,d'));

      service.reset();

      expect(service.csvData()).toBeNull();
      expect(service.parsedData()).toBeNull();
      expect(service.selectedRows()).toEqual([]);
      expect(localStorage.getItem('current-csv')).toBeNull();
    });
  });

  describe('loadFromLocalStorage', () => {
    it('carga el csv guardado en localStorage', () => {
      localStorage.setItem('current-csv', JSON.stringify('x,y\n1,2'));

      service.loadFromLocalStorage();

      expect(service.csvData()).toBe('x,y\n1,2');
    });
  });
});
