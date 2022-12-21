import React, { Fragment } from "react";
var stringify = require("json-stringify-safe");
import styled from "styled-components";

import {
  useReactTable,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getPaginationRowModel,
  flexRender,
} from "@tanstack/react-table";
import { ObjectInspector } from "react-inspector";

// styled-components allow us to create smaller customizable components
const StyledTable = styled.table`
  tbody tr {
    :nth-of-type(odd) {
      background-color: #f0f0f0;
    }
    :hover {
      background-color: lightgrey;
    }
  }

  td {
    padding: 4px;
  }
`;

export default function DynamicTableView(props) {
  const [columnFilters, setColumnFilters] = React.useState([]);
  const [expanded, setExpanded] = React.useState({});
  const [globalFilter, setGlobalFilter] = React.useState("");

  let records = JSON.parse(stringify(props.data));

  let tableKeys = new Set();
  // Since each table comes with it's own schema, we just iterate over
  // all the properties (that are defined) to make the columns dynamic
  records.forEach((record) => {
    for (let prop in record) {
      if (Object.prototype.hasOwnProperty.call(record, prop)) {
        tableKeys.add(prop);
      }
    }
  });

  const columns = React.useMemo(() => {
    return [
      {
        header: "Records",
        columns: [...tableKeys].map((key) => {
          return {
            accessorFn: (row) => {
              // If it's an array, we show length and later turn it into a subrow
              if (Array.isArray(row[key])) {
                return `${key}: ${row[key].length}`;
              }
              // Objects can't just be displayed by default in react, so stringify it and truncate it
              if (typeof row[key] === "object") {
                return `${stringify(row[key]).substring(0, 24)}...`;
              }
              return row[key];
            },
            id: key,
            cell: (info) => {
              const { row, getValue } = info;
              console.log("info: ", info);
              return detectIsExpandableColumn(info) ? (
                <div>
                  <button
                    {...{
                      onClick: row.getToggleExpandedHandler(),
                      style: { cursor: "pointer", border: "none" },
                    }}
                  >
                    {row.getIsExpanded() ? "\u25BC" : "\u25B6"}
                    {getValue()}{" "}
                  </button>
                </div>
              ) : (
                getValue()
              );
            },
            header: () => <span>{key}</span>,
          };
        }),
      },
    ];
  });

  const [data, setData] = React.useState(() => records);

  const table = useReactTable({
    data,
    columns,
    state: {
      columnFilters,
      globalFilter,
      expanded,
    },
    onExpandedChange: setExpanded,
    getSubRows: (row) => {
      if (row.tabs) {
        return row.tabs;
      }
      if (row.parent) {
        return [row.parent];
      }
    },
    renderSubComponent,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  return (
    <div className="p-2">
      <div className="h-2" />
      <StyledTable>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                return (
                  <th key={header.id} colSpan={header.colSpan}>
                    {header.isPlaceholder ? null : (
                      <>
                        <div>
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                        </div>
                        {header.column.getCanFilter() ? (
                          <div>
                            <Filter column={header.column} table={table} />
                          </div>
                        ) : null}
                      </>
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            return (
              <Fragment key={row.id}>
                <tr>
                  {row.getVisibleCells().map((cell) => {
                    return (
                      <td key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </td>
                    );
                  })}
                </tr>
                {row.getIsExpanded() && (
                  <tr>
                    {/* 2nd row is a custom 1 cell row */}
                    <td colSpan={row.getVisibleCells().length}>
                      {renderSubComponent({ row })}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </StyledTable>
      <div className="h-2" />
      <div className="flex items-center gap-2">
        <button
          className="border rounded p-1"
          onClick={() => table.setPageIndex(0)}
          disabled={!table.getCanPreviousPage()}
        >
          {"<<"}
        </button>
        <button
          className="border rounded p-1"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          {"<"}
        </button>
        <button
          className="border rounded p-1"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          {">"}
        </button>
        <button
          className="border rounded p-1"
          onClick={() => table.setPageIndex(table.getPageCount() - 1)}
          disabled={!table.getCanNextPage()}
        >
          {">>"}
        </button>
        <span className="flex items-center gap-1">
          <div>Page</div>
          <strong>
            {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </strong>
        </span>
        <span className="flex items-center gap-1">
          | Go to page:
          <input
            type="number"
            defaultValue={table.getState().pagination.pageIndex + 1}
            onChange={(e) => {
              const page = e.target.value ? Number(e.target.value) - 1 : 0;
              table.setPageIndex(page);
            }}
            className="border p-1 rounded w-16"
          />
        </span>
        <select
          value={table.getState().pagination.pageSize}
          onChange={(e) => {
            table.setPageSize(Number(e.target.value));
          }}
        >
          {[10, 25, 50].map((pageSize) => (
            <option key={pageSize} value={pageSize}>
              Show {pageSize}
            </option>
          ))}
        </select>
      </div>
      <div>{table.getPrePaginationRowModel().rows.length} Rows</div>
      {/* Debug object, uncomment this to see all the values of the table in realtime */}
      {/* <pre>{JSON.stringify(table.getState(), null, 2)}</pre> */}
    </div>
  );
}

function Filter({ column, table }) {
  const columnFilterValue = column.getFilterValue();
  return (
    <>
      <DebouncedInput
        type="text"
        autoComplete="off"
        value={columnFilterValue ?? ""}
        onChange={(value) => column.setFilterValue(value)}
        placeholder={`Search... (${column.getFacetedUniqueValues().size})`}
        className="w-36 border shadow rounded"
        list={column.id + "list"}
      />
      <div className="h-1" />
    </>
  );
}

// A debounced input react component
function DebouncedInput({
  value: initialValue,
  onChange,
  debounce = 500,
  ...props
}) {
  const [value, setValue] = React.useState(initialValue);

  React.useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  React.useEffect(() => {
    const timeout = setTimeout(() => {
      onChange(value);
    }, debounce);

    return () => clearTimeout(timeout);
  }, [value]);

  return (
    <input
      {...props}
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}

const renderSubComponent = ({ row }) => {
  console.log("rendering subrow: ", row);
  return (
    <pre style={{ fontSize: "12px" }}>
      <ObjectInspector data={row.originalSubRows} expandLevel={2} />
    </pre>
  );
};

function detectIsExpandableColumn(info) {
  // XXX - just do this manually until we find a better way
  if (info.column.id === "tabs" || info.column.id === "parent") {
    return true;
  }
  return false;
}
