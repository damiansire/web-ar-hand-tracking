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
});
