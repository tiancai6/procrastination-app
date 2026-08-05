import { registerRootComponent } from 'expo';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

// —— 启动诊断壳 ——
// 独立打包（Release/自签 ipa）下，JS 启动出错时屏幕只会一片空白，无法定位问题。
// 这里把「模块加载错误」和「界面渲染错误」都捕获下来显示到屏幕上。
let startupError = null;
let AppComponent = null;

try {
  AppComponent = require('./App').App;
} catch (e) {
  startupError = e;
}

function formatError(err) {
  if (!err) return '未知错误';
  const msg = err && err.message ? err.message : String(err);
  const stack = err && err.stack ? String(err.stack).split('\n').slice(0, 14).join('\n') : '(无堆栈信息)';
  return msg + '\n\n' + stack;
}

function ErrorScreen({ title, error }) {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.hint}>请把这一屏截图发给开发者</Text>
      <ScrollView style={styles.scroll}>
        <Text style={styles.body} selectable>
          {formatError(error)}
        </Text>
      </ScrollView>
    </View>
  );
}

class Root extends React.Component {
  constructor(props) {
    super(props);
    this.state = { renderError: null };
  }

  static getDerivedStateFromError(error) {
    return { renderError: error };
  }

  render() {
    if (startupError) {
      return <ErrorScreen title="启动失败：模块加载出错" error={startupError} />;
    }
    if (this.state.renderError) {
      return <ErrorScreen title="启动失败：界面渲染出错" error={this.state.renderError} />;
    }
    if (!AppComponent) {
      return <ErrorScreen title="启动失败：未找到 App 组件" error={new Error('./App 未导出名为 App 的组件')} />;
    }
    return <AppComponent />;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingTop: 72,
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#DC2626',
    marginBottom: 6,
  },
  hint: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 14,
  },
  scroll: {
    flex: 1,
  },
  body: {
    fontSize: 12,
    lineHeight: 18,
    color: '#0F172A',
  },
});

registerRootComponent(Root);
