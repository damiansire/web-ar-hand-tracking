import { provideExperimentalZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DataImporterComponent } from './data-importer.component';
import { CsvHandlerService } from '../../services/csv-handler';

describe('DataImporterComponent', () => {
  let component: DataImporterComponent;
  let fixture: ComponentFixture<DataImporterComponent>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [DataImporterComponent],
      providers: [provideExperimentalZonelessChangeDetection()]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DataImporterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('muestra el uploader inicialmente y vuelve a mostrarlo tras resetear', () => {
    const csvHandler = TestBed.inject(CsvHandlerService);
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('app-file-uploader')).not.toBeNull();

    csvHandler.setCsv('a,b\nc,d');
    fixture.detectChanges();
    expect(compiled.querySelector('app-file-uploader')).toBeNull();
    expect(compiled.querySelector('app-data-handle-table')).not.toBeNull();

    csvHandler.reset();
    fixture.detectChanges();
    expect(compiled.querySelector('app-file-uploader')).not.toBeNull();
  });
});
