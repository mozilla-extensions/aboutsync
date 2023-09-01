import React, { useState, useEffect } from 'react'
const { Fetching, ObjectInspector, ErrorDisplay, requireJSM } = require("./common");

export default function AccountInfo(props) {
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);

  const updateUser = async () => {
    let user = await props.fxAccounts.getSignedInUser().catch(error => {
      setError(error);
    });
    setUser(user);
  };

  useEffect(() => {
    updateUser();
  }, []);

  console.log("rendering account info");
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
                         expandLevel={1}/>
        {error && <ErrorDisplay error={error}
                      onClose={() => setError(null)}/>}
      </div>
    );
};
