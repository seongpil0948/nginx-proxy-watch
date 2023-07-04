import path from 'path'
const __dirname = path.resolve();

export default env => {
  return {
    // entry : 번들링할 기본 js 파일들 지정
    entry: ['./src/index.ts'],
    resolve: {
      // modules: ['node_modules'],
      extensions: ['.ts', '.js', '.node']
    },
    target: 'node16.13',
    module: {
      rules:[
        {
          test: /\.ts$/,
          loader: 'ts-loader',
          exclude: /node_modules/
        },
        {
          test: /\.node$/,
          loader: 'node-loader'
        }
      ]
    },
    // output : 번들 결과 출력위치 지정
    output: {
      filename: './index.js',
      path: path.resolve(__dirname + '/dist'),
      library: {
        type: "module",
      },
    },
    experiments: {
      outputModule: true,
    },
    mode: 'production',
    node: {
      __dirname: true,
      __filename: false
    }
  }
}
