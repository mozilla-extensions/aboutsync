const React = require("react");
const { Fetching, ObjectInspector, ErrorDisplay, requireJSM } = require("./common");

class AccountInfo extends React.Component {
  constructor(props) {
    super(props);
    this.state = { user: null };
  }

  componentDidMount() {
    this.updateState().catch(error => {
      this.setState({ error });
    });
  }

  async updateState() {
    let user = await this.props.fxAccounts.getSignedInUser();
    this.setState({ user });
  }

  render() {
    let user = this.state.user;
    if (!user) {
      return <Fetching label="Fetching account info..."/>;
    }
    return (
      <div>
        <div className="profileContainer">
          <div className="avatarContainer">
            <img src={user.avatar} className="avatar"/>
          </div>
          <div className="userInfoContainer">
            <p>{user.displayName}</p>
            <p>{user.email}</p>
          </div>
        </div>
        <ObjectInspector name="Full Profile"
                         data={user}
                         expandLevel={0}/>
        <ErrorDisplay error={this.state.error}
                      onClose={() => this.setState({error: null})}/>
      </div>
    );
  }
}

module.exports = { AccountInfo };
