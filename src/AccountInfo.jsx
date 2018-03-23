const React = require("react");
const { Fetching, ObjectInspector, ErrorDisplay, requireJSM } = require("./common");

class AccountInfo extends React.Component {
  constructor(props) {
    super(props);
    this.state = { user: null, profile: null };
  }

  componentDidMount() {
    this.updateState().catch(error => {
      this.setState({ error });
    });
  }

  async updateState() {
    let user = await this.props.fxAccounts.getSignedInUser();
    this.setState({ user });
    if (user) {
      let profile = await this.props.fxAccounts.getSignedInUserProfile();
      this.setState({ profile });
    }
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
            {this.state.profile &&
              <img src={this.state.profile.avatar} className="avatar"/>}
          </div>
          <div className="userInfoContainer">
            {this.state.profile && <p>{this.state.profile.displayName}</p>}
            <p>{user.email}</p>
          </div>
        </div>
        {this.state.profile &&
          <ObjectInspector name="Full Profile"
                           data={this.state.profile}
                           expandLevel={0}/>}
        <ErrorDisplay error={this.state.error}
                      onClose={() => this.setState({error: null})}/>
      </div>
    );
  }
}

module.exports = { AccountInfo };
