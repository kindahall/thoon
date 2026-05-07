import type { ReactNode } from 'react';

export type TableColumn = {
  align?: 'left' | 'right';
  key: string;
  label: string;
};

export type TableRow = {
  cells: Record<string, ReactNode>;
  id: string;
};

type TableProps = {
  columns: TableColumn[];
  rows: TableRow[];
};

export function Table({ columns, rows }: TableProps) {
  return (
    <div className="ui-table" role="table">
      <div className="ui-table__header" role="row">
        {columns.map((column) => (
          <span className={column.align === 'right' ? 'is-right' : undefined} key={column.key} role="columnheader">
            {column.label}
          </span>
        ))}
      </div>
      {rows.map((row) => (
        <div className="ui-table__row" key={row.id} role="row">
          {columns.map((column) => (
            <span className={column.align === 'right' ? 'is-right' : undefined} key={column.key} role="cell">
              {row.cells[column.key]}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

