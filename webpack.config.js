module.exports = {
  entry: "./src/main.jsx",
  output: {
    filename: "build.js",
    path: `${__dirname}/data`
  },
  resolve: {
    extensions: [".js", ".jsx"]
  },
  module: {
    rules: [
      {
        test: /.jsx$/,
        loader: "babel-loader",
        exclude: /node_modules/,
        options: {
          presets: ["@babel/react"],
        }
      }
    ]
  }
};
