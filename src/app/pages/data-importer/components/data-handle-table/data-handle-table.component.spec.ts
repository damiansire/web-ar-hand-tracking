import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DataHandleTableComponent } from './data-handle-table.component';

describe('DataHandleTableComponent', () => {
  let component: DataHandleTableComponent;
  let fixture: ComponentFixture<DataHandleTableComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataHandleTableComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DataHandleTableComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('muestra el select de delimitador con el estado inicial por defecto', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const delimiterSelect = compiled.querySelector('#delimiter');

    expect(delimiterSelect).not.toBeNull();
  });
});
