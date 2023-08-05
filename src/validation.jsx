const React = require("react");
const { ObjectInspector } = require("./common");
const { TableInspector } = require("./AboutSyncTableInspector");
const { Modal } = require("./Modal");

function ProblemList({desc, ids, map, useTable = ids && ids.length > 10}) {
  if (!ids || !ids.length) {
    return null;
  }
  return (
    <div className="problem-list">
      <p>{desc}</p>
      {useTable ? (
        <TableInspector data={ids.map(id => map.get(id))}/>
      ) : ids.map(id => (
        <div className="problem-list-item" key={id}>
          <ObjectInspector name={id} data={map.get(id)} expandLevel={0}/>
        </div>
      ))}
    </div>
  );
}

class IdDesc extends React.Component {
  constructor(props) {
    super(props);
    this.state = { modalOpen: false };
  }

  renderModal() {
    const title = <span>
      Record <code className="record-id">{this.props.id}</code>
    </span>;
    return (
      <Modal className="records-modal"
             onClose={() => this.setModal(false)}
             open={true}
             title={title}>
        <div className="records-wrap">
          <div className="record">
            <ObjectInspector name="Server Record"
                             data={this.props.serverMap.get(this.props.id)}
                             expandLevel={1}/>
          </div>
          <div className="record">
            <ObjectInspector name="Client Record"
                             data={this.props.clientMap.get(this.props.id)}
                             expandLevel={1}/>
          </div>
        </div>
      </Modal>
    );
  }

  setModal(modalOpen) {
    console.error("setState", modalOpen)
    this.setState({ modalOpen: modalOpen });
  }

  buildTooltip() {
    let descs = [];
    let childItem = this.props.clientMap.get(this.props.id);
    if (childItem) {
      descs.push(`Exists locally with title "${childItem.title}"`);
    } else {
      descs.push("Does not exist locally");
    }
    let serverItem = this.props.serverMap.get(this.props.id);
    if (serverItem) {
      descs.push(`Exists on the server with title "${serverItem.title}"`);
    } else {
      descs.push("Does not exist on the server");
    }
    return descs.join("\n");
  }

  render() {
    // Modal renders through a Portal into #modal-root, so it's not actually
    // a child of this span.
    return (
      <a className="inline-id"
         onClick={e => { this.setModal(true); }}
         title={this.buildTooltip()}>
        {this.state.modalOpen && this.renderModal()}
        {this.props.id}
      </a>
    );
  }
}

function IdArrayDesc(props) {
  return <span>[{
    props.ids.map((id, i) =>
      <span key={id}>
        {i ? ", " : ""}
        <IdDesc {...props} id={id}/>
      </span>
    )
  }]</span>;
}

// View for differences/serverDifferences.
function DifferenceView(props) {
  const {id, fields, isStructural} = props;
  return (
    <div>
      <p>Record <IdDesc id={id} {...props}/> has {isStructural ? "structural " : " "}
      differences between local and server copies.</p>
      <ul className="validation-diff-list">
        {fields.map(field => {
          let clientRecord = props.clientMap.get(id);
          let serverRecord = props.serverMap.get(id);
          let clientValue = clientRecord && clientRecord[field];
          let serverValue = serverRecord && serverRecord[field];
          let clientElem, serverElem;
          let titles = true;
          // Not great that it's hardcoded, but these are common and worth a
          // special display
          if (field === "parentid") {
            clientElem = <IdDesc {...props} id={clientValue}/>
            serverElem = <IdDesc {...props} id={serverValue}/>
          } else if (field === "childGUIDs") {
            clientElem = <div key="client">Client: <IdArrayDesc {...props} ids={clientValue}/></div>
            serverElem = <div key="server">Server: <IdArrayDesc {...props} ids={serverValue}/></div>
            titles = false;
          } else if (typeof clientValue == "object" || typeof serverValue == "object") {
            clientElem = <ObjectInspector expandLevel={0}
                                          name={`Client.${field}`}
                                          data={clientValue}
                                          key="client"/>;
            serverElem = <ObjectInspector expandLevel={0}
                                          name={`Server.${field}`}
                                          data={serverValue}
                                          key="server"/>;
            titles = false;
          } else {
            clientElem = clientValue;
            serverElem = serverValue;
          }
          return (
            <li key={field} className="diff-entry">
              <span className="diff-field">"{field}"</span>: {titles ? (
                <span>Client has {clientElem}, Server has {serverElem}</span>
              ) : (
                [clientElem, serverElem]
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Maps the name of a validation problem to a component type that can handle it.
// Each is passed props of: problems, clientMap, serverMap, serverRecords, and
// clientRecords. This is the default for most types, see
// BookmarkHandlers for the ones used for bookmark validation
const DefaultHandlers = {
  missingIDs: props => (
    <p>There are {props.problems.missingIDs} records without IDs.</p>
  ),

  clientMissing: props => (
    <ProblemList desc="The following server records appear on the server but not on the client."
                 ids={props.problems.clientMissing}
                 map={props.serverMap}/>
  ),

  serverUnexpected: props => (
    <ProblemList desc="The following server records appear on the server but should not have been uploaded."
                 ids={props.problems.serverUnexpected}
                 map={props.serverMap}/>
  ),

  serverMissing: props => (
    <ProblemList desc="The following records appear on the client but not on the server."
                 ids={props.problems.serverMissing}
                 map={props.clientMap}/>
  ),

  serverDeleted: props => (
    <ProblemList desc="The following records appear on the client but were marked as deleted on the server."
                 ids={props.problems.serverDeleted}
                 map={props.clientMap}/>
  ),

  duplicates: props => (
    props.problems.duplicates.map(dupeId => (
      <div key={dupeId}>
        <p>The id <IdDesc id={dupeId} {...props}/> appears multiple times on the server</p>
        <TableInspector data={props.serverRecords.filter(r => r.id === dupeId)}/>
      </div>
    ))
  ),

  differences: props => (
    props.problems.differences.map(({id, differences}) => (
      <DifferenceView {...props} fields={differences} id={id}/>
    ))
  ),
};

// Takes props of problems, clientMap, serverMap, serverRecords, as well as
// a set of handlers, and renders them.
class ResultDisplay extends React.Component {
  static get defaultProps() {
    return {
      handlers: DefaultHandlers
    };
  }

  render() {
    let unknown = [];
    let rendered = [];

    for (let {name, count} of this.props.problems.getSummary()) {
      if (count == 0) {
        continue;
      }
      if (this.props.handlers[name]) {
        let HandlerClass = this.props.handlers[name];
        rendered.push(
          <div key={name} className="validation-problem">
            <h5>{name}: {count} problems</h5>
            <HandlerClass {...this.props}/>
          </div>
        );
      } else {
        unknown.push({ name, count, data: this.props.problems[name] });
      }
    }
    if (rendered.length == 0 && unknown.length == 0) {
      return <p>{"No validation problems found \\o/"}</p>;
    }
    return (
      <div>
        {rendered}
        {unknown.length > 0 && (
          <div>
            <p>Found {unknown.length} problems that about:sync doesn't (yet) render</p>
            <TableInspector data={unknown}/>
          </div>
        )}
      </div>
    );
  }
}

function bookmarkDifference(id, field, clientMap, serverMap) {
  let result = {
    id,
    field,
    localRecord: clientMap.get(id),
    serverRecord: serverMap.get(id),
  };
  if (result.localRecord) {
    result.localValue = result.localRecord[field];
  }

  if (result.serverRecord) {
    result.serverValue = result.serverRecord[field];
  }
  return result;
}

const BookmarkHandlers = Object.assign({}, DefaultHandlers, {
  rootOnServer: props => (
    <p>The root is present on the server, but should not be.</p>
  ),

  missingChildren: props => (
    props.problems.missingChildren.map(({parent, child}) => (
      <div key={`${parent}:${child}`}>
        <p>
          Server record references child <IdDesc id={child} {...props}/> which
          doesn't exist on the server.
        </p>
        <ObjectInspector name="Parent" data={props.serverMap.get(parent)} expandLevel={0}/>
        {props.clientMap.get(child) && [
          <p key="client-child-desc">A record with this ID exists on the client:</p>,
          <ObjectInspector key="client-child-inspector"
                           name="Client"
                           data={props.clientMap.get(child)}
                           expandLevel={0}/>
        ]}
      </div>
    ))
  ),

  multipleParents: props => (
    props.problems.multipleParents.map(({parents, child}) => (
      <div key={child}>
        <p>Child record <IdDesc id={child} {...props}/> appears as a child in multiple parents.</p>
        <ObjectInspector data={props.clientMap.get(child)}/>
        <TableInspector data={parents.map(p => props.serverMap.get(p))}/>
      </div>
    ))
  ),

  parentChildMismatches: props => (
    props.problems.parentChildMismatches.map(({parent, child}) => (
      <div key={`${parent}:${child}`}>
        <p>
          Server-side parent/child mismatch for parent <IdDesc id={parent} {...props}/> (first)
          and child <IdDesc id={child} {...props}/> (second).
        </p>
        <ObjectInspector name="Parent" data={props.serverMap.get(parent)} expandLevel={0}/>
        <ObjectInspector name="Child" data={props.serverMap.get(child)} expandLevel={0}/>
      </div>
    ))
  ),

  cycles: props => (
    props.problems.cycles.map((cycle, i) => (
      <div key={cycle.join(',')}>
        <p>Cycle detected through {cycle.length} items on server</p>
        <TableInspector data={cycle.map(id => props.serverMap.get(id))}/>
      </div>
    ))
  ),

  orphans: props => (
    <div>
      <p>The following server records are orphans</p>
      <TableInspector data={props.problems.orphans.map(({ id, parent }) => ({
        childID: id,
        parentID: parent,
        child: props.serverMap.get(id),
        parent: props.serverMap.get(parent),
        clientChild: props.clientMap.get(id),
        clientParent: props.clientMap.get(parent),
      }))}/>
    </div>
  ),

  clientMissing: props => (
    <ProblemList desc="The following server records appear on the server but not on the client."
                 ids={props.problems.clientMissing}
                 map={props.serverMap}/>
  ),

  deletedParents: props => (
    <ProblemList desc="The following server records have deleted parents, but are not deleted themselves."
                 ids={props.problems.deletedParents}
                 map={props.serverMap}/>
  ),

  duplicateChildren: props => (
    <ProblemList desc="The following server records had the same child id multiple their children lists."
                 ids={props.problems.duplicateChildren}
                 map={props.serverMap}/>
  ),

  parentNotFolder: props => (
    <ProblemList desc="The following server records had a non-folder for a parent."
                 ids={props.problems.parentNotFolder}
                 map={props.serverMap}/>
  ),

  childrenOnNonFolder: props => (
    <ProblemList desc="The following server records were not folders but contained children."
                 ids={props.problems.childrenOnNonFolder}
                 map={props.serverMap}/>
  ),

  clientMissing: props => (
    <ProblemList desc="The following server records appear on the server but not on the client."
                 ids={props.problems.clientMissing}
                 map={props.serverMap}/>
  ),

  serverUnexpected: props => (
    <ProblemList desc="The following server records appear on the server but should not have been uploaded."
                 ids={props.problems.serverUnexpected}
                 map={props.serverMap}/>
  ),

  serverMissing: props => (
    <ProblemList desc="The following records appear on the client but not on the server."
                 ids={props.problems.serverMissing}
                 map={props.clientMap}/>
  ),

  serverDeleted: props => (
    <ProblemList desc="The following records appear on the client but were marked as deleted on the server."
                 ids={props.problems.serverDeleted}
                 map={props.clientMap}/>
  ),

  differences: props => (
    props.problems.differences.map(({id, differences}) => (
      <DifferenceView {...props} key={id} id={id} fields={differences}/>
    ))
  ),

  structuralDifferences: props => (
    props.problems.structuralDifferences.map(({id, differences}) => (
      <DifferenceView {...props} key={id} id={id} fields={differences} isStructural={true}/>
    ))
  ),

  deletedChildren: props => {
    let byId = new Map();
    for (let {parent, child} of props.problems.deletedChildren) {
      let arr = byId.get(parent);
      if (arr) {
        arr.push(child)
      } else {
        byId.set(parent, [child]);
      }
    }
    return Array.from(byId, ([parent, children]) => (
      <div key={parent}>
        The server record <IdDesc {...props} id={parent} /> has {children.length} items
        in its children array that point to (server-side) tombstones:
        <div>Deleted children: <IdArrayDesc {...props} ids={children}/></div>
      </div>
    ));
  },
});

module.exports = {
  ResultDisplay,
  DefaultHandlers,
  BookmarkHandlers,
};
