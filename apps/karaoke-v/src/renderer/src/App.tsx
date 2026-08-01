import { css, Global } from "@emotion/react";
import styled from "@emotion/styled";

const globalStyles = css`
  html,
  body,
  #root {
    margin: 0;
    height: 100%;
  }

  #root {
    display: flex;
    align-items: center;
    justify-content: center;
  }
`;

const Title = styled.h1`
  font-family: system-ui, sans-serif;
`;

export function App() {
  return (
    <>
      <Global styles={globalStyles} />
      <Title>Hello World</Title>
    </>
  );
}
