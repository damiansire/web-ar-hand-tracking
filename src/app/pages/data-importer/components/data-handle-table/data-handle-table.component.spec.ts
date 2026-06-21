import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DataHandleTableComponent } from './data-handle-table.component';
import { CsvHandlerService } from '../../../../services/csv-handler';

describe('DataHandleTableComponent', () => {
  let component: DataHandleTableComponent;
  let fixture: ComponentFixture<DataHandleTableComponent>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [DataHandleTableComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DataHandleTableComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('muestra el select de delimitador con el estado inicial por defecto', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const delimiterSelect = compiled.querySelector('#delimiter');

    expect(delimiterSelect).not.toBeNull();
  });

  it('deriva los headers de la primera fila del csv cargado', () => {
    const csvHandler = TestBed.inject(CsvHandlerService);
    csvHandler.setCsv('nombre,edad\nAna,30\nLuis,25');
    csvHandler.parseCSV();

    expect(component.headers()).toEqual(['nombre', 'edad']);
    expect(component.bodyRows()).toEqual([
      ['Ana', '30'],
      ['Luis', '25'],
    ]);
  });

  it('selecciona una fila con la tecla Enter', () => {
    const csvHandler = TestBed.inject(CsvHandlerService);
    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    spyOn(event, 'preventDefault');

    component.onRowKeydown(event, 1);

    expect(csvHandler.selectedRows()).toEqual([1]);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('selecciona una fila con la barra espaciadora y evita el scroll', () => {
    const csvHandler = TestBed.inject(CsvHandlerService);
    const event = new KeyboardEvent('keydown', { key: ' ' });
    spyOn(event, 'preventDefault');

    component.onRowKeydown(event, 2);

    expect(csvHandler.selectedRows()).toEqual([2]);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('ignora otras teclas', () => {
    const csvHandler = TestBed.inject(CsvHandlerService);
    component.onRowKeydown(new KeyboardEvent('keydown', { key: 'a' }), 1);

    expect(csvHandler.selectedRows()).toEqual([]);
  });

  it('refleja el conteo de filas seleccionadas', () => {
    const csvHandler = TestBed.inject(CsvHandlerService);
    csvHandler.toggleRowSelection(1);
    csvHandler.toggleRowSelection(2);

    expect(component.selectedCount()).toBe(2);
  });

  it('renderiza filas operables por teclado (role/tabindex)', () => {
    const csvHandler = TestBed.inject(CsvHandlerService);
    csvHandler.setCsv('a,b\n1,2');
    csvHandler.parseCSV();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const row = compiled.querySelector('tbody tr');
    expect(row?.getAttribute('role')).toBe('button');
    expect(row?.getAttribute('tabindex')).toBe('0');
  });
});
